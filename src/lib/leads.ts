/**
 * 官网“申请开户”：访客填写的联系方式存在这里，后台“客户 → 开户申请”里查看和跟进。
 * 始终存到正式数据库（测试模式下提交的也不会丢）。
 */
import { liveDb } from "./db";

export interface Lead {
  id: number;
  company: string;
  contact: string;
  phone: string | null;
  wechat: string | null;
  email: string | null;
  volume: string | null;
  note: string | null;
  lang: string | null;
  status: "new" | "contacted" | "done" | "rejected";
  adminNote: string | null;
  createdAt: string;
}

export const LEAD_STATUS_LABEL: Record<Lead["status"], string> = {
  new: "新申请",
  contacted: "已联系",
  done: "已开户",
  rejected: "不合适",
};

/** 预计月单量选项 */
export const VOLUME_OPTIONS = ["少于 500 单", "500 – 3,000 单", "3,000 – 10,000 单", "10,000 单以上"];

function conn() {
  const c = liveDb();
  c.exec(`CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL, contact TEXT NOT NULL, phone TEXT, wechat TEXT, email TEXT, volume TEXT, note TEXT, lang TEXT,
    ip TEXT, status TEXT NOT NULL DEFAULT 'new', admin_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  return c;
}

type Row = { id: number; company: string; contact: string; phone: string | null; wechat: string | null; email: string | null; volume: string | null; note: string | null; lang: string | null; status: Lead["status"]; admin_note: string | null; created_at: string };

const toLead = (r: Row): Lead => ({
  id: r.id, company: r.company, contact: r.contact, phone: r.phone, wechat: r.wechat, email: r.email, volume: r.volume, note: r.note,
  lang: r.lang, status: r.status, adminNote: r.admin_note, createdAt: r.created_at,
});

export function createLead(l: Omit<Lead, "id" | "status" | "adminNote" | "createdAt">, ip: string | null) {
  const c = conn();
  // 防刷：同一个 IP 一小时内最多 5 条
  if (ip) {
    const n = (c.prepare("SELECT COUNT(*) AS n FROM leads WHERE ip = ? AND created_at > datetime('now', '-1 hour')").get(ip) as { n: number }).n;
    if (n >= 5) throw new Error("提交太频繁，请稍后再试，或直接联系我们");
  }
  return Number(
    c.prepare("INSERT INTO leads (company, contact, phone, wechat, email, volume, note, lang, ip) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(l.company, l.contact, l.phone, l.wechat, l.email, l.volume, l.note, l.lang, ip).lastInsertRowid,
  );
}

export function listLeads(): Lead[] {
  return (conn().prepare("SELECT * FROM leads ORDER BY id DESC LIMIT 500").all() as Row[]).map(toLead);
}

export function newLeadCount() {
  return (conn().prepare("SELECT COUNT(*) AS n FROM leads WHERE status = 'new'").get() as { n: number }).n;
}

export function updateLead(id: number, status: Lead["status"], adminNote: string | null) {
  conn().prepare("UPDATE leads SET status = ?, admin_note = ? WHERE id = ?").run(status, adminNote, id);
}
