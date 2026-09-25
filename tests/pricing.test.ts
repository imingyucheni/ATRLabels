import { describe, expect, it } from "vitest";
import { computePrice, resolveRule, roundUp } from "@/lib/pricing";

describe("加价计算", () => {
  it("成本加 5%", () => {
    expect(computePrice(10, { percent: 5, fixed: 0, minProfit: 0 })).toBe(10.5);
  });

  it("百分比 + 固定加价", () => {
    expect(computePrice(10, { percent: 5, fixed: 0.5, minProfit: 0 })).toBe(11);
  });

  it("低价单按最低利润兜底", () => {
    // 4 * 1.05 = 4.2，利润只有 0.2，低于最低利润 1
    expect(computePrice(4, { percent: 5, fixed: 0, minProfit: 1 })).toBe(5);
  });

  it("按步长向上取整", () => {
    expect(computePrice(10.01, { percent: 5, fixed: 0, minProfit: 0 }, 0.1)).toBe(10.6);
    expect(roundUp(12.3, 0.1)).toBe(12.3);
    expect(roundUp(12.301, 0.1)).toBe(12.4); // 有零头就向上进
    expect(roundUp(12.3 + 1e-10, 0.1)).toBe(12.3); // 浮点误差不进位
    expect(roundUp(12.31, 0.1)).toBe(12.4);
    expect(roundUp(12.01, 1)).toBe(13);
  });

  it("服务商价格超过两位小数时向上取到分", () => {
    expect(roundUp(6.6144, 0.01)).toBe(6.62);
    expect(roundUp(6.61, 0.01)).toBe(6.61);
    expect(roundUp(0.1 + 0.2, 0.01)).toBe(0.3);
    expect(computePrice(6.6144, { percent: 0, fixed: 0, minProfit: 0 })).toBe(6.62);
    expect(computePrice(6.6144, { percent: 5, fixed: 0, minProfit: 0 })).toBe(6.95); // 6.94512 → 6.95
  });

  it("逐字段覆盖：客户 > 渠道 > 全局", () => {
    const g = { percent: 5, fixed: 0, minProfit: 0.5 };
    expect(resolveRule(g)).toEqual(g);
    expect(resolveRule(g, { percent: 8, fixed: null })).toEqual({ percent: 8, fixed: 0, minProfit: 0.5 });
    expect(resolveRule(g, { percent: 8 }, { percent: 3, fixed: 1 })).toEqual({ percent: 3, fixed: 1, minProfit: 0.5 });
    // 客户显式设 0 也要生效
    expect(resolveRule(g, { percent: 8 }, { percent: 0 })).toEqual({ percent: 0, fixed: 0, minProfit: 0.5 });
  });
});
