/**
 * 加价规则：
 * - 四级，逐字段取第一个有值的：客户在这个渠道的专属加价 > 客户专属加价 > 渠道加价 > 全局默认
 * - 每次修改加价（全局 / 渠道 / 客户 / 客户在某渠道）都记一条修改记录，后台可以查
 * - 每张订单下单时用的规则（含来源）存在订单里
 */
import { db, getChannel, getCustomer, getSettings, isInternalCustomer } from "./db";
import type { MarkupRule, PartialRule } from "./pricing";
import { activePromotion } from "./promotions";

export type MarkupSource = "promo" | "customer_channel" | "customer" | "channel" | "global" | "house";

export const MARKUP_SOURCE_LABEL: Record<MarkupSource, string> = {
  promo: "限时活动价",
  customer_channel: "客户在该渠道的专属加价",
  customer: "客户专属加价",
  channel: "渠道加价",
  global: "全局默认",
  house: "公司自用（成本价）",
};

export const MARKUP_SCOPE_LABEL: Record<"global" | "channel" | "customer" | "customer_channel", string> = {
  global: "全局默认",
  channel: "渠道加价",
  customer: "客户专属",
  customer_channel: "客户·渠道",
};

let ready: unknown = null;
function conn() {
  const c = db();
  if (ready !== c) {
    c.exec(`CREATE TABLE IF NOT EXISTS customer_channel_markup (
      customer_id INTEGER NOT NULL,
      channel_code TEXT NOT NULL,
      percent REAL, fixed REAL, min_profit REAL,
      PRIMARY KEY (customer_id, channel_code)
    );
    CREATE TABLE IF NOT EXISTS markup_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      customer_id INTEGER,
      channel_code TEXT,
      label TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS markup_log_customer ON markup_log (customer_id);`);
    ready = c;
  }
  return c;
}

const clean = (r: PartialRule | null | undefined): PartialRule => ({
  percent: r?.percent ?? null,
  fixed: r?.fixed ?? null,
  minProfit: r?.minProfit ?? null,
});
const isEmpty = (r: PartialRule | null | undefined) => r?.percent == null && r?.fixed == null && r?.minProfit == null;
const same = (a: PartialRule | null | undefined, b: PartialRule | null | undefined) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));

/* ---------------- 客户在某个渠道的专属加价 ---------------- */

export function customerChannelMarkups(customerId: number): Record<string, PartialRule> {
  const rows = conn().prepare("SELECT channel_code, percent, fixed, min_profit FROM customer_channel_markup WHERE customer_id = ?").all(customerId) as {
    channel_code: string; percent: number | null; fixed: number | null; min_profit: number | null;
  }[];
  return Object.fromEntries(rows.map((r) => [r.channel_code, { percent: r.percent, fixed: r.fixed, minProfit: r.min_profit }]));
}

export function customerChannelMarkup(customerId: number, code: string): PartialRule | null {
  return customerChannelMarkups(customerId)[code] ?? null;
}

/** 保存客户在各渠道的专属加价（全空 = 删除，沿用上一级），有变化的记修改记录 */
export function setCustomerChannelMarkups(customerId: number, rules: Record<string, PartialRule>) {
  const cur = customerChannelMarkups(customerId);
  const c = conn();
  const cust = getCustomer(customerId);
  c.transaction(() => {
    for (const [code, r] of Object.entries(rules)) {
      if (same(cur[code], r)) continue;
      if (isEmpty(r)) c.prepare("DELETE FROM customer_channel_markup WHERE customer_id = ? AND channel_code = ?").run(customerId, code);
      else
        c.prepare(
          "INSERT INTO customer_channel_markup (customer_id, channel_code, percent, fixed, min_profit) VALUES (?,?,?,?,?) ON CONFLICT(customer_id, channel_code) DO UPDATE SET percent = excluded.percent, fixed = excluded.fixed, min_profit = excluded.min_profit",
        ).run(customerId, code, r.percent ?? null, r.fixed ?? null, r.minProfit ?? null);
      logMarkupChange({ scope: "customer_channel", customerId, channelCode: code, label: `${cust?.name ?? customerId} · ${getChannel(code)?.name ?? code}`, before: cur[code], after: r });
    }
  })();
}

/* ---------------- 生效规则 ---------------- */

/** 这个客户在这个渠道实际用的加价规则，以及百分比来自哪一级 */
export function effectiveRule(customerId: number, channelCode: string, opts: { ignorePromo?: boolean } = {}): MarkupRule & { source: MarkupSource } {
  if (isInternalCustomer(customerId)) return { percent: 0, fixed: 0, minProfit: 0, source: "house" };
  // 限时活动：活动期间所有客户都按活动加价（可以是负数），记下返利比例算利润
  const promo = opts.ignorePromo ? null : activePromotion(channelCode);
  if (promo) return { percent: promo.customerPercent, fixed: 0, minProfit: 0, source: "promo", promoId: promo.id, rebate: promo.rebatePercent };
  const levels: [MarkupSource, PartialRule | null | undefined][] = [
    ["customer_channel", customerChannelMarkup(customerId, channelCode)],
    ["customer", getCustomer(customerId)?.markup],
    ["channel", getChannel(channelCode)?.markup],
    ["global", getSettings().markup],
  ];
  const pick = (k: "percent" | "fixed" | "minProfit") => {
    for (const [src, r] of levels) if (r?.[k] !== null && r?.[k] !== undefined) return { v: r[k] as number, src };
    return { v: 0, src: "global" as MarkupSource };
  };
  const p = pick("percent");
  return { percent: p.v, fixed: pick("fixed").v, minProfit: pick("minProfit").v, source: p.src };
}

/* ---------------- 修改记录 ---------------- */

export interface MarkupLogRow {
  id: number;
  scope: "global" | "channel" | "customer" | "customer_channel";
  customerId: number | null;
  channelCode: string | null;
  label: string;
  before: PartialRule | null;
  after: PartialRule | null;
  createdAt: string;
}

export function logMarkupChange(e: { scope: MarkupLogRow["scope"]; customerId?: number | null; channelCode?: string | null; label: string; before?: PartialRule | null; after?: PartialRule | null }) {
  if (same(e.before, e.after)) return;
  conn()
    .prepare("INSERT INTO markup_log (scope, customer_id, channel_code, label, before_json, after_json) VALUES (?,?,?,?,?,?)")
    .run(e.scope, e.customerId ?? null, e.channelCode ?? null, e.label, JSON.stringify(clean(e.before)), JSON.stringify(clean(e.after)));
}

export function listMarkupLog(opts: { customerId?: number; limit?: number } = {}): MarkupLogRow[] {
  const rows = conn()
    .prepare(`SELECT * FROM markup_log ${opts.customerId ? "WHERE customer_id = ?" : ""} ORDER BY id DESC LIMIT ${Math.min(500, Number(opts.limit) || 100)}`)
    .all(...(opts.customerId ? [opts.customerId] : [])) as {
    id: number; scope: MarkupLogRow["scope"]; customer_id: number | null; channel_code: string | null; label: string; before_json: string | null; after_json: string | null; created_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id, scope: r.scope, customerId: r.customer_id, channelCode: r.channel_code, label: r.label,
    before: r.before_json ? JSON.parse(r.before_json) : null, after: r.after_json ? JSON.parse(r.after_json) : null, createdAt: r.created_at,
  }));
}

/** 规则显示成一行字：+12% + $0.50，最低利润 $1.00；没设置的项显示“沿用” */
export function describeRule(r: PartialRule | null | undefined, inherit = "沿用"): string {
  const f = (v: number | null | undefined, fmt: (n: number) => string) => (v === null || v === undefined ? inherit : fmt(v));
  return `${f(r?.percent, (n) => `+${n}%`)} · ${f(r?.fixed, (n) => `+$${n.toFixed(2)}`)} · 最低利润 ${f(r?.minProfit, (n) => `$${n.toFixed(2)}`)}`;
}
