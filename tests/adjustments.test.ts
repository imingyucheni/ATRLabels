import { describe, expect, it } from "vitest";
import { customerAmountFor, guessColumns, parseAmount, parseCsv } from "@/lib/adjustments";
import { customerSafeColumns, describeRow, guessHeaderRow, weightDiff } from "@/lib/sheetGuess";

// ShipBest 实际发来的 GOFO 补差表表头（2026-09）
const GOFO_HEADER = ["客户","运单号","日期","客户单号","产品编码","预报口岸","注入口岸","签入中心","目的站点","到件州","长(cm)","宽(cm)","高(cm)","结算重量(lb)","结算重量(oz)","预报重量(oz)","实重(LB)","申报货值","燃油费","分拣费","揽收费","派送费","提货费","其他费","超重费","超尺寸费","超最大限制费","禁运品处理费","运费退还","燃油费退还","退件费","异形费","旺季附加费","超长超大费","超长费-不可发","偏远费","住宅派送费","卡转费","贴标费","库内操作费","退件运输费","拦截附加费","换单费","邮编","邮编分区","预报分区","Zone区","运单状态","备注说明","应收金额","实收金额","补收金额"];

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
    expect(guessColumns(["序号", "跟踪号", "预报重量", "实际重量", "补差金额", "备注"])).toEqual({ keyCol: 1, altKeyCol: -1, amountCol: 4, reasonCol: 5 });
    expect(guessColumns(["Tracking Number", "Zone", "Adjustment"])).toEqual({ keyCol: 0, altKeyCol: -1, amountCol: 2, reasonCol: -1 });
  });

  it("识别 ShipBest GOFO 补差表的列（补收金额，而不是“运费退还”等费用列）", () => {
    expect(guessColumns(GOFO_HEADER)).toEqual({ keyCol: 1, altKeyCol: 3, amountCol: 51, reasonCol: 48 });
    const row = GOFO_HEADER.map(() => "0");
    Object.assign(row, { 1: "GFUS00000000000001", 13: "2.046", 15: "25", 44: "", 45: "zone4", 46: "4", 48: "重量调整", 51: "0.06" });
    Object.assign(row, { 14: "32.736", 16: "1.036" });
    // 用同单位（oz）对比预报和结算重量
    expect(describeRow(GOFO_HEADER, row, 48)).toBe("重量调整：预报 25 oz → 结算 32.74 oz（超出 7.74 oz） · 实重 1.036 lb · zone4");
    expect(weightDiff(GOFO_HEADER, row)).toEqual({ declared: 25, billed: 32.74, diff: 7.74, unit: "oz" });
    row[46] = "5";
    expect(describeRow(GOFO_HEADER, row, 48)).toContain("分区 zone4 → zone5");
    // 只有 lb 的结算重量时换算成 oz 对比
    const h2 = ["运单号", "结算重量(lb)", "预报重量(oz)", "补收金额"];
    expect(weightDiff(h2, ["X", "2.046", "25", "0.06"])).toEqual({ declared: 25, billed: 32.74, diff: 7.74, unit: "oz" });
    expect(guessHeaderRow([["", "", "34.37"], GOFO_HEADER, row])).toBe(1);
  });

  it("转嫁规则", () => {
    const rule = { percent: 10, fixed: 0.5, minProfit: 1 };
    expect(customerAmountFor(2, "at_cost", rule)).toBe(2);
    expect(customerAmountFor(2, "with_markup", rule)).toBe(2.2);
    expect(customerAmountFor(-2, "with_markup", rule)).toBe(-2.2);
    const five = { percent: 5, fixed: 0.5, minProfit: 1 };
    // 补收 0.06，加价 5% → 0.063 → 向上取到 0.07
    expect(customerAmountFor(0.06, "with_markup", five)).toBe(0.07);
    // 刚好整分的不因浮点误差多进一分
    expect(customerAmountFor(0.2, "with_markup", five)).toBe(0.21);
    expect(customerAmountFor(1.08, "with_markup", five)).toBe(1.14);
    // 退款舍去零头
    expect(customerAmountFor(-0.06, "with_markup", five)).toBe(-0.06);
    expect(customerAmountFor(2, "none", rule)).toBe(0);
  });

  it("导出给客户的列不含成本、费用和我们的账户名", () => {
    const cols = customerSafeColumns(GOFO_HEADER, [1, 3, 51]).map((i) => GOFO_HEADER[i]);
    expect(cols).toEqual([
      "日期", "到件州", "长(cm)", "宽(cm)", "高(cm)", "结算重量(lb)", "结算重量(oz)", "预报重量(oz)", "实重(LB)",
      "邮编", "邮编分区", "预报分区", "Zone区", "运单状态", "备注说明",
    ]);
    for (const c of cols) expect(c).not.toMatch(/金额|费|应收|实收|客户|产品/);
  });
});

describe("客户端报错过滤", async () => {
  const { publicError } = await import("@/lib/portal");
  it("去掉内部信息，保留对客户有用的原因", () => {
    expect(publicError("[11200] OMS 账户余额不足，请先充值（customer account balance sufficient in order!）")).toBe("系统繁忙，请稍后再试或联系客服");
    expect(publicError("[11012] 签名错误（SIGN error）")).toBe("系统繁忙，请稍后再试或联系客服");
    expect(publicError("[1] 国家[US],邮编[78701]不通邮")).toBe("地址未覆盖：这个渠道送不到该邮编");
    expect(publicError("无法报价：[10024] 包裹重量不在该渠道的下单重量范围内（Logistics product weight out range!）")).toBe(
      "无法报价：包裹重量不在该渠道的下单重量范围内（Logistics product weight out range!）",
    );
    expect(publicError("收件人邮编必填")).toBe("收件人邮编必填");
  });
});
