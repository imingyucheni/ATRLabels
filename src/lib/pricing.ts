export interface MarkupRule {
  /** 百分比加价，5 表示 +5% */
  percent: number;
  /** 每单固定加价 */
  fixed: number;
  /** 每单最低利润 */
  minProfit: number;
}

/** 可部分覆盖的规则：null/undefined 表示沿用上一级。 */
export type PartialRule = { [K in keyof MarkupRule]?: number | null };

/**
 * 逐字段合并：客户设置 > 渠道设置 > 全局默认。
 * 例如客户只设置了百分比，那么固定加价和最低利润仍然沿用渠道或全局的值。
 */
export function resolveRule(global: MarkupRule, channel?: PartialRule | null, customer?: PartialRule | null): MarkupRule {
  const pick = (k: keyof MarkupRule) => customer?.[k] ?? channel?.[k] ?? global[k];
  return { percent: pick("percent"), fixed: pick("fixed"), minProfit: pick("minProfit") };
}

/** 按步长向上取整，例如 step=0.1 时 12.31 -> 12.4。 */
export function roundUp(value: number, step: number): number {
  if (!(step > 0)) return Math.round(value * 100) / 100;
  // 先按分取整，避免 12.3000000001 这类浮点误差被多进一档
  const cents = Math.round(value * 100);
  const stepCents = Math.max(1, Math.round(step * 100));
  return (Math.ceil(cents / stepCents) * stepCents) / 100;
}

/** 报价 = max(成本 × (1 + 百分比) + 固定加价, 成本 + 最低利润)，再向上取整。 */
export function computePrice(cost: number, rule: MarkupRule, roundingStep = 0.01): number {
  const marked = cost * (1 + rule.percent / 100) + rule.fixed;
  const floor = cost + rule.minProfit;
  return roundUp(Math.max(marked, floor), roundingStep);
}

export function money(v: number | null | undefined, currency = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return `${v.toFixed(2)}${currency ? " " + currency : ""}`;
}
