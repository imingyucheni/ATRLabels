import { describe, expect, it } from "vitest";
import { customerAmountFor, guessColumns, parseAmount, parseCsv } from "@/lib/adjustments";

describe("补差表格解析", () => {
  it("识别各种金额写法", () => {
    expect(parseAmount("1.5")).toBe(1.5);
    expect(parseAmount("-2.30")).toBe(-2.3);
    expect(parseAmount("$1,234.50")).toBe(1234.5);
    expect(parseAmount("(3.20)")).toBe(-3.2);
    expect(parseAmount("USD 5")).toBe(5);
    expect(parseAmount("¥8元")).toBe(8);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });

  it("解析 CSV（引号、逗号）", () => {
    const rows = parseCsv(Buffer.from('运单号,补差金额,原因\n9400111,1.20,"重量差异, 实重 3lb"\n9400222,-0.5,分区\n'));
    expect(rows).toEqual([
      ["运单号", "补差金额", "原因"],
      ["9400111", "1.20", "重量差异, 实重 3lb"],
      ["9400222", "-0.5", "分区"],
    ]);
  });

  it("解析 GBK 编码的 CSV（中文 Excel 另存）", () => {
    // "运单号,金额\n1,2\n" 的 GBK 编码
    const gbk = Buffer.from([0xd4, 0xcb, 0xb5, 0xa5, 0xba, 0xc5, 0x2c, 0xbd, 0xf0, 0xb6, 0xee, 0x0a, 0x31, 0x2c, 0x32, 0x0a]);
    expect(parseCsv(gbk)[0]).toEqual(["运单号", "金额"]);
  });

  it("自动猜测列", () => {
    expect(guessColumns(["序号", "跟踪号", "预报重量", "实际重量", "补差金额", "备注"])).toEqual({ keyCol: 1, amountCol: 4, reasonCol: 5 });
    expect(guessColumns(["Tracking Number", "Zone", "Adjustment"])).toEqual({ keyCol: 0, amountCol: 2, reasonCol: -1 });
  });

  it("转嫁规则", () => {
    const rule = { percent: 10, fixed: 0.5, minProfit: 1 };
    expect(customerAmountFor(2, "at_cost", rule)).toBe(2);
    expect(customerAmountFor(2, "with_markup", rule)).toBe(2.2);
    expect(customerAmountFor(-2, "with_markup", rule)).toBe(-2.2);
    expect(customerAmountFor(2, "none", rule)).toBe(0);
  });
});
