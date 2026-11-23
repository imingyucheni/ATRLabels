/**
 * 客户忘记密码：
 * - 配置了 SMTP（SMTP_HOST 等环境变量）时，给客户邮箱发一个 1 小时内有效的重置链接；
 * - 没配置、没有可信的网址拼链接、或者发送失败时，申请会出现在后台“客户”页面，由客服一键重置密码后告诉客户。
 * 每次申请（包括邮箱不存在的）都记一条“重置密码申请记录”，客户说没收到时后台查得到是怎么回事。
 */
import { createHash, randomBytes } from "node:crypto";
import { sendMail, smtpConfigured } from "./mailer";
import { recordEmail } from "./notify";
import { db, getCustomer, getCustomerLogin, getSettings, setCustomerPassword } from "./db";
import { hashPassword } from "./password";

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

/* ---------------- 申请记录（后台排查用） ---------------- */

/** 每次申请的结果 */
export type ResetOutcome = "emailed" | "failed" | "manual" | "no_url" | "duplicate" | "no_account" | "disabled" | "internal";

export const RESET_OUTCOME_LABEL: Record<ResetOutcome, string> = {
  emailed: "已发重置邮件",
  failed: "邮件发送失败（等客服处理）",
  manual: "没配置发件邮箱（等客服处理）",
  no_url: "没配置客户 OMS 网址，链接没发（等客服处理）",
  duplicate: "10 分钟内重复申请（上一封已发出，没再发）",
  no_account: "没有这个登录邮箱",
  disabled: "这个账号没有开通登录",
  internal: "公司自用账户（不能登录客户 OMS）",
};

function logTable() {
  const c = db();
  c.exec(`CREATE TABLE IF NOT EXISTS password_reset_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    customer_id INTEGER,
    outcome TEXT NOT NULL,
    error TEXT,
    ip TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return c;
}

/** 记一条申请记录（只留最近 90 天） */
export function logResetAttempt(email: string, customerId: number | null, outcome: ResetOutcome, error?: string | null, ip?: string | null) {
  const c = logTable();
  c.prepare("INSERT INTO password_reset_log (email, customer_id, outcome, error, ip) VALUES (?, ?, ?, ?, ?)").run(email.slice(0, 120), customerId, outcome, error?.slice(0, 300) ?? null, ip ?? null);
  c.prepare("DELETE FROM password_reset_log WHERE created_at < datetime('now', '-90 days')").run();
}

export interface ResetAttempt {
  id: number;
  email: string;
  customerId: number | null;
  customerName: string | null;
  outcome: ResetOutcome;
  error: string | null;
  createdAt: string;
}

export function recentResetAttempts(limit = 30): ResetAttempt[] {
  return (logTable()
    .prepare(
      `SELECT l.*, c.name AS customer_name FROM password_reset_log l LEFT JOIN customers c ON c.id = l.customer_id ORDER BY l.id DESC LIMIT ?`,
    )
    .all(limit) as { id: number; email: string; customer_id: number | null; customer_name: string | null; outcome: ResetOutcome; error: string | null; created_at: string }[])
    .map((r) => ({ id: r.id, email: r.email, customerId: r.customer_id, customerName: r.customer_name, outcome: r.outcome, error: r.error, createdAt: r.created_at }));
}

/* ---------------- 申请 ---------------- */

/**
 * 提交忘记密码申请；不管邮箱是否存在，返回给客户的结果都一样，避免被用来试探账号。
 * baseUrl 是拼重置链接用的可信网址；没有（null）时不发链接，申请交给客服处理。
 */
export async function requestReset(email: string, baseUrl: string | null, ip?: string | null): Promise<{ emailed: boolean }> {
  const canEmail = smtpConfigured() && !!baseUrl;
  const c = getCustomerLogin(email);
  if (!c || !c.enabled) {
    logResetAttempt(email, c?.id ?? null, c ? "disabled" : "no_account", null, ip);
    return { emailed: canEmail };
  }
  // 同一客户 10 分钟内已经发出过重置邮件：不再发（防止被刷）。上一次没发出去的（发送失败、等客服处理）可以再申请
  const recent = db()
    .prepare("SELECT 1 FROM password_resets WHERE customer_id = ? AND emailed = 1 AND used_at IS NULL AND created_at > datetime('now', '-10 minutes')")
    .get(c.id);
  if (recent) {
    logResetAttempt(email, c.id, "duplicate", null, ip);
    return { emailed: true };
  }
  const token = randomBytes(24).toString("base64url");
  const r = db()
    .prepare("INSERT INTO password_resets (customer_id, token_hash, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))")
    .run(c.id, sha(token));
  if (!smtpConfigured()) {
    logResetAttempt(email, c.id, "manual", null, ip);
    return { emailed: false };
  }
  if (!baseUrl) {
    logResetAttempt(email, c.id, "no_url", "服务器没有配置 APP_URL / OMS_URL（客户 OMS 的网址），不能拼重置链接", ip);
    return { emailed: false };
  }
  const { brandName } = getSettings();
  const link = `${baseUrl.replace(/\/$/, "")}/portal/reset?token=${token}`;
  const subject = `${brandName} · 重置密码 / Reset your password`;
  try {
    await sendMail(
      email,
      subject,
      [
        "你好，",
        "",
        "点击下面的链接设置新密码（1 小时内有效）：",
        link,
        "",
        "如果不是你本人操作，请忽略这封邮件。",
        "",
        "Hello,",
        "Click the link above to set a new password (valid for 1 hour). If you didn't ask for this, you can ignore this email.",
        "",
        brandName,
      ].join("\n"),
    );
    db().prepare("UPDATE password_resets SET emailed = 1 WHERE id = ?").run(Number(r.lastInsertRowid));
    recordEmail(c.id, "password_reset", email, subject, null);
    logResetAttempt(email, c.id, "emailed", null, ip);
    return { emailed: true };
  } catch (e) {
    // 发送失败：申请留着，后台“客户”页面可以一键重置
    const msg = (e as Error).message;
    recordEmail(c.id, "password_reset", email, subject, msg);
    logResetAttempt(email, c.id, "failed", msg, ip);
    return { emailed: false };
  }
}

export function checkToken(token: string): number | null {
  const r = db()
    .prepare("SELECT id, customer_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')")
    .get(sha(token)) as { id: number; customer_id: number } | undefined;
  return r ? r.customer_id : null;
}

export function resetWithToken(token: string, password: string) {
  const r = db()
    .prepare("SELECT id, customer_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')")
    .get(sha(token)) as { id: number; customer_id: number } | undefined;
  if (!r) throw new Error("链接已失效，请重新申请");
  if (password.length < 8) throw new Error("新密码至少 8 位");
  setCustomerPassword(r.customer_id, hashPassword(password));
  db().prepare("UPDATE password_resets SET used_at = datetime('now') WHERE customer_id = ? AND used_at IS NULL").run(r.customer_id);
  return r.customer_id;
}

/** 后台待处理的重置申请（没发出邮件、还没处理的；同一客户申请了几次只列最新一条） */
export function pendingResets() {
  return (
    db()
      .prepare(
        `SELECT p.id, p.customer_id, p.created_at, c.name, c.portal_email FROM password_resets p JOIN customers c ON c.id = p.customer_id
         WHERE p.id IN (SELECT MAX(id) FROM password_resets WHERE emailed = 0 AND handled_at IS NULL AND used_at IS NULL GROUP BY customer_id)
         ORDER BY p.id DESC`,
      )
      .all() as { id: number; customer_id: number; created_at: string; name: string; portal_email: string }[]
  );
}

/** 后台一键重置：生成新密码并标记申请已处理 */
/** 重置密码申请是哪个客户的（权限检查用） */
export function resetRequestCustomer(requestId: number): number | null {
  const r = db().prepare("SELECT customer_id FROM password_resets WHERE id = ?").get(requestId) as { customer_id: number } | undefined;
  return r?.customer_id ?? null;
}

export function adminResetFromRequest(requestId: number): { customerName: string; password: string } {
  const r = db().prepare("SELECT customer_id FROM password_resets WHERE id = ?").get(requestId) as { customer_id: number } | undefined;
  if (!r) throw new Error("申请不存在");
  const pw = randomBytes(6).toString("base64url");
  setCustomerPassword(r.customer_id, hashPassword(pw));
  db().prepare("UPDATE password_resets SET handled_at = datetime('now') WHERE customer_id = ? AND handled_at IS NULL").run(r.customer_id);
  return { customerName: getCustomer(r.customer_id)?.name ?? "", password: pw };
}
