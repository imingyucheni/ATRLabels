/**
 * 加价规则：
 * - 四级，逐字段取第一个有值的：客户在这个渠道的专属加价 > 客户专属加价 > 渠道加价 > 全局默认
 * - 每次修改加价（全局 / 渠道 / 客户 / 客户在某渠道）都记一条修改记录，后台可以查
 * - 每张订单下单时用的规则（含来源）存在订单里
 */
import { db, getChannel, getCustomer, getSettings, isInternalCustomer, listChannels, updateChannel } from "./db";
import { computePrice, type MarkupRule, type PartialRule } from "./pricing";
import { activePromotion } from "./promotions";

export type MarkupSource = "promo" | "customer_channel" | "customer" | "channel" | "global" | "house" | "failover" | "prospect";

export const MARKUP_SOURCE_LABEL: Record<MarkupSource, string> = {
  promo: "限时活动价",
  customer_channel: "客户在该渠道的专属加价",
  customer: "客户专属加价",
  channel: "渠道加价",
  global: "全局默认",
  house: "公司自用（成本价）",
  failover: "自动备用（客户价按原渠道的限时活动价）",
  prospect: "新客户试算",
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

/** 某个渠道上所有客户的专属加价（改返利时检查有没有低于返利的负数加价） */
export function customerChannelMarkupsFor(code: string): { customerId: number; customerName: string; percent: number | null }[] {
  const rows = conn().prepare("SELECT customer_id, percent FROM customer_channel_markup WHERE channel_code = ?").all(code) as { customer_id: number; percent: number | null }[];
  return rows.map((r) => ({ customerId: r.customer_id, customerName: getCustomer(r.customer_id)?.name ?? String(r.customer_id), percent: r.percent }));
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

/** 正在进行的限时活动的加价规则（可以是负数，记下活动返利算利润）；没有活动返回 null */
export function promoRuleFor(channelCode: string): (MarkupRule & { source: MarkupSource }) | null {
  const promo = activePromotion(channelCode);
  return promo ? { percent: promo.customerPercent, fixed: 0, minProfit: 0, source: "promo", promoId: promo.id, rebate: promo.rebatePercent } : null;
}

/** 这个渠道现在出单能拿到的服务商返利 %：进行中的限时活动返利，否则渠道长期返利 */
export function rebateFor(channelCode: string): number {
  return activePromotion(channelCode)?.rebatePercent ?? getChannel(channelCode)?.rebate ?? 0;
}

/**
 * 这个客户在这个渠道的加价规则，以及百分比来自哪一级。
 * 有限时活动时返回活动规则；实际报价用 pickRule（活动价和平时价取低的）。
 */
export function effectiveRule(customerId: number, channelCode: string, opts: { ignorePromo?: boolean } = {}): MarkupRule & { source: MarkupSource } {
  if (isInternalCustomer(customerId)) {
    // 公司自用按成本价；返利照样记下（利润、对账要算）
    const rebate = rebateFor(channelCode);
    return { percent: 0, fixed: 0, minProfit: 0, source: "house", ...(rebate > 0 ? { rebate } : {}) };
  }
  const promo = opts.ignorePromo ? null : promoRuleFor(channelCode);
  if (promo) return promo;
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
  const rebate = getChannel(channelCode)?.rebate ?? 0;
  return { percent: p.v, fixed: pick("fixed").v, minProfit: pick("minProfit").v, source: p.src, ...(rebate > 0 ? { rebate } : {}) };
}

/**
 * 按这一单的成本选规则：限时活动价和平时价取低的。
 * 活动只能让客户更便宜，不能让本来价格更低的客户（例如谈好的大客户价、长期返利渠道的负数加价）在活动期间变贵。
 * base = 平时的规则（新客户试算时传入临时加价；不传按这个客户的加价设置）。公司自用账户不参加活动。
 */
export function pickRule(customerId: number, channelCode: string, cost: number, step: number, base?: MarkupRule): { rule: MarkupRule; price: number; promo: boolean; normalPrice: number } {
  const normal = base ?? effectiveRule(customerId, channelCode, { ignorePromo: true });
  const normalPrice = computePrice(cost, normal, step);
  const promo = normal.source === "house" ? null : promoRuleFor(channelCode);
  if (promo) {
    const promoPrice = computePrice(cost, promo, step);
    if (promoPrice < normalPrice) return { rule: promo, price: promoPrice, promo: true, normalPrice };
  }
  return { rule: normal, price: normalPrice, promo: false, normalPrice };
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

export function logMarkupChange(e: { scope: MarkupLogRow["scope"]; customerId?: number | null; channelCode?: string | null; label: string; before?: PartialRule | null; after?: PartialRule | null; force?: boolean }) {
  if (!e.force && same(e.before, e.after)) return;
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
export function describeRule(r: PartialRule | null | undefined, inherit = "沿用", t: (s: string) => string = (s) => s): string {
  const f = (v: number | null | undefined, fmt: (n: number) => string) => (v === null || v === undefined ? t(inherit) : fmt(v));
  return `${f(r?.percent, (n) => `${n < 0 ? "-" : "+"}${Math.abs(n)}%`)} · ${f(r?.fixed, (n) => `+$${n.toFixed(2)}`)} · ${t("最低利润")} ${f(r?.minProfit, (n) => `$${n.toFixed(2)}`)}`;
}

/**
 * 加价不允许低于成本：固定加价、最低利润不能为负数；
 * 加价 % 只有渠道有服务商返利时才能填负数，最低到 -返利%（再低就亏本）。
 */
export function negativeRule(r: PartialRule, who = "", rebate = 0): string | null {
  if ([r.fixed, r.minProfit].some((v) => v !== null && v !== undefined && v < 0)) return `${who}固定加价、最低利润不能为负数（会低于成本出单）`;
  const p = r.percent;
  if (p === null || p === undefined || p >= 0) return null;
  if (!(rebate > 0)) return `${who}加价不能为负数（会低于成本出单）。如果服务商对这个渠道有返利，先在“设置 → 物流渠道”填上服务商返利 %，就可以填负数`;
  if (p < -rebate) return `${who}加价最低只能到 -${rebate}%（这个渠道服务商返利 ${rebate}%，再低就亏本）`;
  return null;
}

/* ---------------- 活动结束后遗留的负数加价 ---------------- */

/**
 * 低于渠道长期返利能覆盖的负数加价（多半是限时活动期间填的）：活动结束后仍然生效，
 * 价格被“成本 + 最低利润”兜住，等于按成本价出。已经调回正常（不是负数、或在长期返利范围内）的不算。
 */
export interface LeftoverNegative {
  scope: "customer_channel" | "channel";
  customerId: number | null;
  customerName: string | null;
  channelCode: string;
  channelName: string;
  current: PartialRule;
  /** 恢复后的加价 %：改成负数之前的设置（修改记录里查到的）；null = 清空，沿用上一级 */
  restorePercent: number | null;
  /** 恢复后实际生效的加价 % */
  restoreEffective: number;
}

/** 修改记录里最近一次把这一项改成现在这个负数之前的加价 %（查不到、或之前也是负数 → null） */
function percentBefore(scope: "customer_channel" | "channel", customerId: number | null, code: string, current: number, rebate: number): number | null {
  const rows = conn()
    // 限时活动的记录也记在渠道下面（after = 活动加价），不是渠道加价的修改，跳过
    .prepare(`SELECT before_json, after_json FROM markup_log WHERE scope = ? AND channel_code = ? AND ${customerId ? "customer_id = ?" : "customer_id IS NULL"} AND label NOT LIKE '限时活动%' ORDER BY id DESC`)
    .all(...(customerId ? [scope, code, customerId] : [scope, code])) as { before_json: string | null; after_json: string | null }[];
  for (const r of rows) {
    const after = r.after_json ? (JSON.parse(r.after_json) as PartialRule) : null;
    if (after?.percent !== current) continue;
    const p = r.before_json ? (JSON.parse(r.before_json) as PartialRule).percent ?? null : null;
    return p !== null && p < -rebate ? null : p;
  }
  return null;
}

export function leftoverNegativeMarkups(): LeftoverNegative[] {
  const out: LeftoverNegative[] = [];
  const rebateOf = (code: string) => getChannel(code)?.rebate ?? 0;
  for (const c of listChannels()) {
    const p = c.markup?.percent;
    if (p === null || p === undefined || p >= -c.rebate || p >= 0) continue;
    const restorePercent = percentBefore("channel", null, c.code, p, c.rebate);
    out.push({ scope: "channel", customerId: null, customerName: null, channelCode: c.code, channelName: c.name, current: clean(c.markup), restorePercent, restoreEffective: restorePercent ?? getSettings().markup?.percent ?? 0 });
  }
  const rows = conn().prepare("SELECT customer_id, channel_code, percent, fixed, min_profit FROM customer_channel_markup WHERE percent < 0 ORDER BY customer_id").all() as {
    customer_id: number; channel_code: string; percent: number; fixed: number | null; min_profit: number | null;
  }[];
  for (const r of rows) {
    const rebate = rebateOf(r.channel_code);
    if (r.percent >= -rebate) continue;
    const cust = getCustomer(r.customer_id);
    if (!cust || isInternalCustomer(r.customer_id)) continue;
    const restorePercent = percentBefore("customer_channel", r.customer_id, r.channel_code, r.percent, rebate);
    // 沿用上一级：客户专属 → 渠道（渠道本身也是遗留负数时按它恢复后的） → 全局
    const chLeft = out.find((x) => x.scope === "channel" && x.channelCode === r.channel_code);
    const inherited = cust.markup?.percent ?? (chLeft ? chLeft.restoreEffective : getChannel(r.channel_code)?.markup?.percent) ?? getSettings().markup?.percent ?? 0;
    out.push({
      scope: "customer_channel", customerId: r.customer_id, customerName: cust.name, channelCode: r.channel_code, channelName: getChannel(r.channel_code)?.name ?? r.channel_code,
      current: { percent: r.percent, fixed: r.fixed, minProfit: r.min_profit },
      restorePercent,
      restoreEffective: restorePercent ?? inherited,
    });
  }
  return out;
}

/** 把遗留的负数加价恢复成改之前的设置（查不到就清空，沿用上一级）；固定加价、最低利润不动。返回改了几项 */
export function restoreLeftoverNegativeMarkups(): number {
  const list = leftoverNegativeMarkups();
  for (const x of list) {
    const next = { ...x.current, percent: x.restorePercent };
    if (x.scope === "customer_channel") setCustomerChannelMarkups(x.customerId!, { [x.channelCode]: next });
    else {
      const ch = getChannel(x.channelCode)!;
      logMarkupChange({ scope: "channel", channelCode: x.channelCode, label: `${ch.name}（活动结束后恢复）`, before: x.current, after: next });
      updateChannel(x.channelCode, ch.enabled, next);
    }
  }
  return list.length;
}
