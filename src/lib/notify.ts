/**
 * 给客户发邮件通知（中英双语）。每个客户可以在“账户设置 → 邮件通知”里逐项关闭，每封邮件底部也有一键退订链接。
 * 通知类型：充值结果、余额不足、面单异常、取消完成、补差扣款 / 退还。
 * 没配置发件邮箱（SMTP）或后台关掉总开关时不发；发送失败只记日志，不影响业务。
 */
import crypto from "node:crypto";
import { db, getCustomer, getSettings } from "./db";
import { sendMail, smtpConfigured } from "./mailer";
import { omsOrigin } from "./sites";

export const NOTIFY_EVENTS = ["topup", "lowBalance", "exception", "cancel", "adjustment"] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

/** 各类通知的名称（中文，界面上翻译） */
export const NOTIFY_LABEL: Record<NotifyEvent, string> = {
  topup: "充值到账 / 未通过",
  lowBalance: "余额不足提醒",
  exception: "面单异常",
  cancel: "取消完成、费用退回",
  adjustment: "补差扣款 / 退还",
};

export interface NotifyPrefs {
  events: Record<NotifyEvent, boolean>;
  /** 收通知的邮箱（空 = 登录邮箱） */
  email: string;
  /** 余额低于多少美元时提醒 */
  lowBalance: number;
}

export const DEFAULT_PREFS: NotifyPrefs = {
  events: { topup: true, lowBalance: true, exception: true, cancel: true, adjustment: true },
  email: "",
  lowBalance: 20,
};

function ensure() {
  const c = db();
  const cols = (c.prepare("PRAGMA table_info(customers)").all() as { name: string }[]).map((x) => x.name);
  if (!cols.includes("notify_json")) c.exec("ALTER TABLE customers ADD COLUMN notify_json TEXT");
  if (!cols.includes("low_notified")) c.exec("ALTER TABLE customers ADD COLUMN low_notified INTEGER NOT NULL DEFAULT 0");
  c.exec(`CREATE TABLE IF NOT EXISTS email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, event TEXT, to_email TEXT, subject TEXT, status TEXT, error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  return c;
}

export function getNotifyPrefs(customerId: number): NotifyPrefs {
  const r = ensure().prepare("SELECT notify_json FROM customers WHERE id = ?").get(customerId) as { notify_json: string | null } | undefined;
  const saved = r?.notify_json ? (JSON.parse(r.notify_json) as Partial<NotifyPrefs>) : {};
  return { ...DEFAULT_PREFS, ...saved, events: { ...DEFAULT_PREFS.events, ...(saved.events ?? {}) } };
}

export function saveNotifyPrefs(customerId: number, p: NotifyPrefs) {
  ensure().prepare("UPDATE customers SET notify_json = ? WHERE id = ?").run(JSON.stringify(p), customerId);
}

/* ---------------- 退订链接 ---------------- */

function sign(customerId: number, event: string) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET || "dev").update(`unsub:${customerId}:${event}`).digest("hex").slice(0, 24);
}

export function unsubscribeUrl(customerId: number, event: NotifyEvent) {
  const base = omsOrigin() || process.env.APP_URL || "";
  return `${base}/portal/unsubscribe?c=${customerId}&e=${event}&s=${sign(customerId, event)}`;
}

export function unsubscribe(customerId: number, event: string, sig: string): boolean {
  if (!(NOTIFY_EVENTS as readonly string[]).includes(event)) return false;
  const expect = sign(customerId, event);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
  const p = getNotifyPrefs(customerId);
  p.events[event as NotifyEvent] = false;
  saveNotifyPrefs(customerId, p);
  return true;
}

/* ---------------- 发送 ---------------- */

export function notifyReady() {
  return getSettings().notifyEnabled !== false && smtpConfigured();
}

/** 发一封通知：zh / en 两段内容；客户关掉了这一类就不发 */
export async function notify(customerId: number, event: NotifyEvent, subject: { zh: string; en: string }, body: { zh: string[]; en: string[] }) {
  if (!notifyReady()) return;
  const c = getCustomer(customerId);
  if (!c) return;
  const prefs = getNotifyPrefs(customerId);
  if (!prefs.events[event]) return;
  const login = (db().prepare("SELECT portal_email FROM customers WHERE id = ?").get(customerId) as { portal_email: string | null } | undefined)?.portal_email;
  const to = (prefs.email || login || c.email || "").trim();
  if (!to) return;
  const { brandName } = getSettings();
  const oms = `${omsOrigin() || process.env.APP_URL || ""}/portal`;
  const unsub = unsubscribeUrl(customerId, event);
  const text = [
    ...body.zh,
    "",
    `登录查看：${oms}`,
    "",
    "——",
    ...body.en,
    "",
    `Sign in: ${oms}`,
    "",
    `${brandName}`,
    `不想再收到这类邮件？/ Unsubscribe: ${unsub}`,
    "（也可以在“账户设置 → 邮件通知”里修改 / You can also change this in Settings → Email notifications）",
  ].join("\n");
  const subj = `${brandName} · ${subject.zh} / ${subject.en}`;
  const log = ensure().prepare("INSERT INTO email_log (customer_id, event, to_email, subject, status, error) VALUES (?,?,?,?,?,?)");
  try {
    await sendMail(to, subj, text);
    log.run(customerId, event, to, subj, "sent", null);
  } catch (e) {
    log.run(customerId, event, to, subj, "failed", (e as Error).message.slice(0, 300));
  }
}

/** 不等待发送结果（业务流程里调用） */
export function notifyLater(...args: Parameters<typeof notify>) {
  if (!notifyReady()) return;
  void notify(...args).catch(() => null);
}

/* ---------------- 余额不足：跌破阈值时提醒一次，充值回到阈值以上后重置 ---------------- */

const lowTimers = new Map<number, NodeJS.Timeout>();

export function checkLowBalanceSoon(customerId: number) {
  if (!notifyReady()) return;
  clearTimeout(lowTimers.get(customerId));
  // 批量下单时会连续扣款，等几秒再统一判断，只发一封
  const t = setTimeout(() => {
    lowTimers.delete(customerId);
    void checkLowBalance(customerId).catch(() => null);
  }, 5000);
  t.unref?.();
  lowTimers.set(customerId, t);
}

async function checkLowBalance(customerId: number) {
  const conn = ensure();
  const bal = (conn.prepare("SELECT COALESCE(SUM(amount), 0) AS b FROM ledger WHERE customer_id = ?").get(customerId) as { b: number }).b;
  const prefs = getNotifyPrefs(customerId);
  const sent = (conn.prepare("SELECT low_notified FROM customers WHERE id = ?").get(customerId) as { low_notified: number } | undefined)?.low_notified;
  if (bal >= prefs.lowBalance) {
    if (sent) conn.prepare("UPDATE customers SET low_notified = 0 WHERE id = ?").run(customerId);
    return;
  }
  if (sent) return;
  conn.prepare("UPDATE customers SET low_notified = 1 WHERE id = ?").run(customerId);
  await notify(
    customerId,
    "lowBalance",
    { zh: "余额不足提醒", en: "Low balance" },
    {
      zh: [`你的账户余额只剩 $${bal.toFixed(2)}，低于 $${prefs.lowBalance.toFixed(2)}。为避免影响出单，请及时充值。`],
      en: [`Your balance is $${bal.toFixed(2)}, below $${prefs.lowBalance.toFixed(2)}. Please top up to avoid interruptions.`],
    },
  );
}

/* ---------------- 补差：同一个客户几秒内的多条合并成一封 ---------------- */

const adjQueue = new Map<number, { items: { ref: string; amount: number; reason: string | null }[]; timer: NodeJS.Timeout }>();

export function queueAdjustmentNotice(customerId: number, ref: string, amount: number, reason: string | null) {
  if (!notifyReady()) return;
  const q = adjQueue.get(customerId) ?? { items: [], timer: undefined as unknown as NodeJS.Timeout };
  q.items.push({ ref, amount, reason });
  clearTimeout(q.timer);
  q.timer = setTimeout(() => {
    adjQueue.delete(customerId);
    const total = q.items.reduce((a, x) => a + x.amount, 0);
    const lines = q.items.slice(0, 30).map((x) => `${x.ref}: ${x.amount >= 0 ? "-" : "+"}$${Math.abs(x.amount).toFixed(2)}${x.reason ? ` (${x.reason})` : ""}`);
    const more = q.items.length > 30 ? [`… +${q.items.length - 30}`] : [];
    void notify(
      customerId,
      "adjustment",
      { zh: `运费补差 ${q.items.length} 笔`, en: `${q.items.length} postage adjustment(s)` },
      {
        zh: [`承运商核实了包裹的实际重量 / 尺寸 / 分区，以下订单的运费有调整（正数为补扣，负数为退还），合计 ${total >= 0 ? "扣除" : "退还"} $${Math.abs(total).toFixed(2)}：`, ...lines, ...more],
        en: [`The carrier re-measured these packages (weight / size / zone). Net ${total >= 0 ? "charged" : "refunded"}: $${Math.abs(total).toFixed(2)}.`, ...lines, ...more],
      },
    ).catch(() => null);
  }, 8000);
  q.timer.unref?.();
  adjQueue.set(customerId, q);
}

export function recentEmailLog(limit = 50) {
  return ensure()
    .prepare("SELECT e.*, c.name AS customer_name FROM email_log e LEFT JOIN customers c ON c.id = e.customer_id ORDER BY e.id DESC LIMIT ?")
    .all(limit) as { id: number; customer_name: string | null; event: string; to_email: string; subject: string; status: string; error: string | null; created_at: string }[];
}
