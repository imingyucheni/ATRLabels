/**
 * 客户忘记密码：
 * - 配置了 SMTP（SMTP_HOST 等环境变量）时，给客户邮箱发一个 1 小时内有效的重置链接；
 * - 没配置时，申请会出现在后台“客户”页面，由客服一键重置密码后告诉客户。
 */
import { createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { db, getCustomer, getCustomerLogin, getSettings, setCustomerPassword } from "./db";
import { hashPassword } from "./password";

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

export function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

async function sendMail(to: string, subject: string, text: string) {
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await t.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
}

/** 提交忘记密码申请；不管邮箱是否存在都返回同样结果，避免被用来试探账号 */
export async function requestReset(email: string, baseUrl: string): Promise<{ emailed: boolean }> {
  const c = getCustomerLogin(email);
  if (!c || !c.enabled) return { emailed: smtpConfigured() };
  // 同一客户 10 分钟内只处理一次
  const recent = db()
    .prepare("SELECT 1 FROM password_resets WHERE customer_id = ? AND created_at > datetime('now', '-10 minutes')")
    .get(c.id);
  if (recent) return { emailed: smtpConfigured() };
  const token = randomBytes(24).toString("base64url");
  const r = db()
    .prepare("INSERT INTO password_resets (customer_id, token_hash, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))")
    .run(c.id, sha(token));
  if (smtpConfigured()) {
    const { brandName } = getSettings();
    const link = `${(process.env.APP_URL || baseUrl).replace(/\/$/, "")}/portal/reset?token=${token}`;
    try {
      await sendMail(email, `${brandName} · 重置密码`, `你好，\n\n点击下面的链接设置新密码（1 小时内有效）：\n${link}\n\n如果不是你本人操作，请忽略这封邮件。\n\n${brandName}`);
      db().prepare("UPDATE password_resets SET emailed = 1 WHERE id = ?").run(Number(r.lastInsertRowid));
      return { emailed: true };
    } catch {
      // 发送失败时仍保留申请，后台可以处理
    }
  }
  return { emailed: false };
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

/** 后台待处理的重置申请（没发出邮件、还没处理的） */
export function pendingResets() {
  return (
    db()
      .prepare(
        `SELECT p.id, p.customer_id, p.created_at, c.name, c.portal_email FROM password_resets p JOIN customers c ON c.id = p.customer_id
         WHERE p.emailed = 0 AND p.handled_at IS NULL AND p.used_at IS NULL ORDER BY p.id DESC`,
      )
      .all() as { id: number; customer_id: number; created_at: string; name: string; portal_email: string }[]
  );
}

/** 后台一键重置：生成新密码并标记申请已处理 */
export function adminResetFromRequest(requestId: number): { customerName: string; password: string } {
  const r = db().prepare("SELECT customer_id FROM password_resets WHERE id = ?").get(requestId) as { customer_id: number } | undefined;
  if (!r) throw new Error("申请不存在");
  const pw = randomBytes(6).toString("base64url");
  setCustomerPassword(r.customer_id, hashPassword(pw));
  db().prepare("UPDATE password_resets SET handled_at = datetime('now') WHERE customer_id = ? AND handled_at IS NULL").run(r.customer_id);
  return { customerName: getCustomer(r.customer_id)?.name ?? "", password: pw };
}
