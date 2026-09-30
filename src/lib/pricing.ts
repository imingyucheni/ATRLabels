export interface MarkupRule {
  /** 百分比加价，5 表示 +5% */
  percent: number;
  /** 每单固定加价 */
  fixed: number;
  /** 每单最低利润 */
  minProfit: number;
  /** 加价比例来自哪一级（记在订单里给后台看；老订单没有） */
  source?: string;
  /** 服务商返利比例（%，限时活动或渠道长期返利），利润计算要加上返利；promoId = 限时活动编号 */
  promoId?: number;
  rebate?: number;
}

/** 可部分覆盖的规则：null/undefined 表示沿用上一级。 */
export type PartialRule = { [K in "percent" | "fixed" | "minProfit"]?: number | null };

/**
 * 逐字段合并：客户设置 > 渠道设置 > 全局默认。
 * 例如客户只设置了百分比，那么固定加价和最低利润仍然沿用渠道或全局的值。
 */
export function resolveRule(global: MarkupRule, channel?: PartialRule | null, customer?: PartialRule | null): MarkupRule {
  const pick = (k: "percent" | "fixed" | "minProfit") => customer?.[k] ?? channel?.[k] ?? global[k];
  return { percent: pick("percent"), fixed: pick("fixed"), minProfit: pick("minProfit") };
}

/** 按步长向上取整，例如 step=0.1 时 12.31 -> 12.4。 */
export function roundUp(value: number, step: number): number {
  if (!(step > 0)) return Math.round(value * 100) / 100;
  // 只去掉浮点误差（12.3000000001 不会被多进一档），真实的零头一律向上进：6.6144 → 6.62
  const cents = Math.round(value * 100 * 1e6) / 1e6;
  const stepCents = Math.max(1, Math.round(step * 100));
  return (Math.ceil(cents / stepCents) * stepCents) / 100;
}

/**
 * 报价 = max(成本 × (1 + 百分比) + 固定加价, 实际成本 + 最低利润)，再向上取整。
 * 实际成本 = 成本 − 服务商返利；有返利时加价可以是负数。
 */
export function computePrice(cost: number, rule: MarkupRule, roundingStep = 0.01): number {
  const marked = cost * (1 + rule.percent / 100) + rule.fixed;
  // 限时活动价可以低于账面成本（有返利兜底），不套最低利润
  const floor = rule.source === "promo" ? -Infinity : cost * (1 - (rule.rebate ?? 0) / 100) + rule.minProfit;
  return roundUp(Math.max(marked, floor), roundingStep);
}

/** 加价百分比带正负号：“+5%” / “-15%” */
export function signedPercent(p: number): string {
  return `${p < 0 ? "-" : "+"}${Math.abs(p)}%`;
}

/** 美元金额（余额等）：“$200.00” / “-$4.18” */
export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
}

export function money(v: number | null | undefined, currency = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return `${v.toFixed(2)}${currency ? " " + currency : ""}`;
}
