/**
 * 限时活动价：服务商某个渠道有返利（例如 OnTrac 返 30%：花 $10，服务商之后返 $3）时，
 * 在活动期间这个渠道给客户更低的加价（可以是负数，例如 -10%，客户价低于账面成本），
 * 我们的实际利润 = 客户价 − 成本 + 返利。客户端显示“限时折扣”和原价。
 * - 活动期间对所有客户生效（公司自用账户仍按成本价）
 * - 客户价不能低于扣掉返利后的实际成本（会亏本），保存时检查
 */
import { db, getChannel } from "./db";
import { localDate } from "./reports";

export interface Promotion {
  id: number;
  channelCode: string;
  /** 客户看到的活动名称，例如“限时折扣” */
  label: string;
  /** 服务商返利比例（%），只给后台算利润 */
  rebatePercent: number;
  /** 活动期间给客户的加价（%），可以是负数 */
  customerPercent: number;
  /** 开始、结束日期（美西时间，含当天），YYYY-MM-DD */
  startsOn: string;
  endsOn: string;
  enabled: boolean;
  note: string | null;
  createdAt: string;
}

let ready: unknown = null;
function conn() {
  const c = db();
  if (ready !== c) {
    c.exec(`CREATE TABLE IF NOT EXISTS promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_code TEXT NOT NULL,
      label TEXT NOT NULL,
      rebate_percent REAL NOT NULL DEFAULT 0,
      customer_percent REAL NOT NULL,
      starts_on TEXT NOT NULL,
      ends_on TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    ready = c;
  }
  return c;
}

type Row = { id: number; channel_code: string; label: string; rebate_percent: number; customer_percent: number; starts_on: string; ends_on: string; enabled: number; note: string | null; created_at: string };
const toPromo = (r: Row): Promotion => ({
  id: r.id, channelCode: r.channel_code, label: r.label, rebatePercent: r.rebate_percent, customerPercent: r.customer_percent,
  startsOn: r.starts_on, endsOn: r.ends_on, enabled: !!r.enabled, note: r.note, createdAt: r.created_at,
});

export function listPromotions(): Promotion[] {
  return (conn().prepare("SELECT * FROM promotions ORDER BY ends_on DESC, id DESC").all() as Row[]).map(toPromo);
}

/** 这个渠道今天（美西日期）正在进行的活动；有多个时取最新建的 */
export function activePromotion(code: string, today = localDate()): Promotion | null {
  const r = conn()
    .prepare("SELECT * FROM promotions WHERE channel_code = ? AND enabled = 1 AND starts_on <= ? AND ends_on >= ? ORDER BY id DESC LIMIT 1")
    .get(code, today, today) as Row | undefined;
  return r ? toPromo(r) : null;
}

export type PromoStatus = "active" | "upcoming" | "ended" | "off";
export function promoStatus(p: Promotion, today = localDate()): PromoStatus {
  if (!p.enabled) return "off";
  if (p.endsOn < today) return "ended";
  if (p.startsOn > today) return "upcoming";
  return "active";
}

/** 检查活动设置；有问题返回原因。id = 正在修改的活动（不和自己比重叠） */
export function validatePromotion(p: Omit<Promotion, "id" | "createdAt">, id?: number | null): string | null {
  if (!getChannel(p.channelCode)) return "渠道不存在";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(p.endsOn)) return "请填写开始和结束日期";
  if (p.endsOn < p.startsOn) return "结束日期不能早于开始日期";
  if (!(p.rebatePercent >= 0 && p.rebatePercent < 100)) return "返利比例要在 0 到 100 之间";
  if (!Number.isFinite(p.customerPercent) || p.customerPercent <= -100) return "活动加价填写不正确";
  // 客户价 = 成本 × (1 + 活动加价)，实际成本 = 成本 × (1 − 返利)：客户价不能低于实际成本
  if (1 + p.customerPercent / 100 < 1 - p.rebatePercent / 100 - 1e-9)
    return `活动加价 ${p.customerPercent}% 低于返利 ${p.rebatePercent}% 能覆盖的范围，会亏本（最低只能设到 -${p.rebatePercent}%）`;
  if (!p.label.trim()) return "请填写客户看到的活动名称";
  // 同一个渠道同时只能有一个活动（重叠时只有最新的生效，设置页却两个都显示“进行中”）
  if (p.enabled) {
    const clash = listPromotions().find((x) => x.id !== id && x.enabled && x.channelCode === p.channelCode && x.startsOn <= p.endsOn && x.endsOn >= p.startsOn);
    if (clash) return `这个渠道在 ${clash.startsOn} ~ ${clash.endsOn} 已经有活动「${clash.label}」，日期不能重叠（先停用或删除原来的活动）`;
  }
  return null;
}

export function savePromotion(id: number | null, p: Omit<Promotion, "id" | "createdAt">): number {
  const args = [p.channelCode, p.label.trim().slice(0, 30), p.rebatePercent, p.customerPercent, p.startsOn, p.endsOn, p.enabled ? 1 : 0, p.note?.slice(0, 200) || null];
  if (id) {
    conn().prepare("UPDATE promotions SET channel_code=?, label=?, rebate_percent=?, customer_percent=?, starts_on=?, ends_on=?, enabled=?, note=? WHERE id = ?").run(...args, id);
    return id;
  }
  return Number(conn().prepare("INSERT INTO promotions (channel_code, label, rebate_percent, customer_percent, starts_on, ends_on, enabled, note) VALUES (?,?,?,?,?,?,?,?)").run(...args).lastInsertRowid);
}

export function getPromotion(id: number): Promotion | null {
  const r = conn().prepare("SELECT * FROM promotions WHERE id = ?").get(id) as Row | undefined;
  return r ? toPromo(r) : null;
}

export function deletePromotion(id: number) {
  conn().prepare("DELETE FROM promotions WHERE id = ?").run(id);
}
