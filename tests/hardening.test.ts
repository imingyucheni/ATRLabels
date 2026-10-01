import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-hard-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", country: "US", city: "Los Angeles", address1: "1 Main St", zipCode: "90058", province: "CA", phone: "9095550100" },
  recipient: { nameFirst: "Jason", nameLast: "Menard", country: "US", city: "Omaha", address1: "2 Elm St", zipCode: "68104", province: "NE" },
  pkg: { length: 10, width: 8, height: 4, weight: 1, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "A1", productNameCn: "T恤", productNameEn: "T-shirt", quantity: 1, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 10, width: 8, height: 4, weight: 1, unit: 3 }],
};

describe("安全检查修复", () => {
  let db: typeof import("@/lib/db");
  let svc: typeof import("@/lib/service");
  let ledger: typeof import("@/lib/ledger");
  let sb: typeof import("@/lib/shipbest/client");
  let cid: number;

  beforeAll(async () => {
    db = await import("@/lib/db");
    svc = await import("@/lib/service");
    ledger = await import("@/lib/ledger");
    sb = await import("@/lib/shipbest/client");
    await svc.syncChannels();
    cid = db.saveCustomer(null, { name: "加固客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(cid, db.listChannels().map((c) => c.code));
    ledger.addLedger({ customerId: cid, type: "topup", amount: 100, createdBy: "admin" });
  });

  async function order(ref: string) {
    const q = (await svc.quoteAll(cid, req)).find((x) => x.ok)!;
    return svc.createLabel({ customerId: cid, channelCode: q.channelCode, req, expectedPrice: q.price!, customerRef: ref, waitForLabel: false });
  }

  it("已取消并退款的单，刷新时服务商还显示已出面单：不会变回已出单，只提示核实", async () => {
    const id = await order("H-1");
    const client = sb.getShipBestClient();
    const orig = client.cancelOrder.bind(client);
    client.cancelOrder = async () => { throw new sb.ShipBestError(11203, "nonsupport"); };
    try {
      await svc.requestCancel(id);
    } finally {
      client.cancelOrder = orig;
    }
    expect(db.getShipment(id)!.status).toBe("cancel_requested");
    svc.confirmCancelled(id, 0, 0);
    const bal = ledger.balanceOf(cid);
    const origGet = client.getOrder.bind(client);
    client.getOrder = async (k) => ({ ...(await origGet(k)), status: 4 });
    try {
      await svc.refreshShipment(id);
    } finally {
      client.getOrder = origGet;
    }
    const s = db.getShipment(id)!;
    expect(s.status).toBe("cancelled");
    expect(s.errorMsg).toContain("核实");
    expect(ledger.balanceOf(cid)).toBe(bal);
  });

  it("确认取消：只能用于取消处理中的单，取消费不能是负数或超过客户价", async () => {
    const id = await order("H-2");
    expect(() => svc.confirmCancelled(id, 0, 0)).toThrow(/不在取消处理中/);
    db.updateShipment(id, { status: "cancel_requested" });
    const price = db.getShipment(id)!.price;
    expect(() => svc.confirmCancelled(id, -50, 0)).toThrow(/0 到客户价/);
    expect(() => svc.confirmCancelled(id, price + 1, 0)).toThrow(/0 到客户价/);
    expect(() => svc.confirmCancelled(id, 0, -1)).toThrow(/负数/);
    svc.confirmCancelled(id, 0, 0);
    expect(() => svc.confirmCancelled(id, 0, 0)).toThrow(/不在取消处理中/); // 不能重复确认
  });

  it("服务商返回非 JSON（网关超时）：保留订单等刷新，不删单退款", async () => {
    const client = sb.getShipBestClient();
    const orig = client.createOrder.bind(client);
    client.createOrder = async () => { throw new Error("ShipBest 接口返回异常（HTTP 504）<html>"); };
    try {
      const id = await order("H-3");
      expect(db.getShipment(id)).toMatchObject({ status: "pending" });
      expect(db.getShipment(id)!.errorMsg).toContain("提交结果未知");
    } finally {
      client.createOrder = orig;
    }
  });

  it("CSV 导出：开头是 = + - @ Tab 的内容不会被 Excel 当公式", async () => {
    const { csvCell } = await import("@/lib/csv");
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("\t=1+1")).toBe("'\t=1+1");
    expect(csvCell("-12.5")).toBe("-12.5");
  });

  it("上传的 xlsx 解压后过大（压缩炸弹）直接拒绝，正常文件通过", async () => {
    const { assertZipSize, zipStore } = await import("@/lib/zip");
    const ok = zipStore([{ name: "a.txt", data: new TextEncoder().encode("hello") }]);
    expect(() => assertZipSize(ok)).not.toThrow();
    expect(() => assertZipSize(ok, 3)).toThrow(/太多/);
    expect(() => assertZipSize(Buffer.from("not a zip at all, definitely not"))).toThrow(/格式不对/);
  });
});

describe("客户看到的报错不含服务商信息", () => {
  it("去掉服务商名称、渠道代码、后台设置提示和接口原文", async () => {
    const { publicError } = await import("@/lib/portal");
    expect(publicError("嘉谷：渠道 580914 还没有设置仓库 ID（设置 → 万邑）")).toBe("系统繁忙，请稍后再试或联系客服");
    expect(publicError("嘉谷接口返回异常（HTTP 502）<html>")).toBe("系统繁忙，请稍后再试或联系客服");
    expect(publicError("[10024] 包裹重量不在该渠道的下单重量范围内")).toBe("包裹重量不在该渠道的下单重量范围内");
    const m = publicError("所有渠道都无法报价：GOFO-（91710） · SB 运费试算失败（JG-580914）");
    expect(m).not.toMatch(/SB|JG-|嘉谷|万邑/);
  });
});

describe("批量导入、补差金额解析", () => {
  it("没填单号但有收件人的行报错（不会并到上一单）；Excel 丢了前导 0 的邮编补回；州全称换成代码", async () => {
    const { parseOrders } = await import("@/lib/batch");
    const head = ["自定义单号", "收件联系人姓", "收件联系人名", "收件国家", "收件省州", "收件市府", "收件地址1", "收件邮编", "包裹长", "包裹宽", "包裹高", "包裹重量", "包裹单位", "SKU", "品名(英文)", "数量", "申报单价"];
    const sender = { nameFirst: "W", nameLast: "H", country: "US", city: "Chino", address1: "1 Main", zipCode: "91710", province: "CA", phone: "9095550100" };
    const r = parseOrders([
      head,
      ["A-1", "Roe", "Jane", "US", "Massachusetts", "Boston", "1 Elm", "2134", "10", "8", "4", "1", "in/lb", "S1", "Shirt", "1", "5"],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "S2", "Cap", "1", "3"],
      ["", "Doe", "John", "US", "CA", "LA", "2 Oak", "90001", "10", "8", "4", "1", "in/lb", "S3", "Hat", "1", "4"],
    ], sender);
    expect(r.orders).toHaveLength(2);
    expect(r.orders[0].req.skuList.map((s) => s.sku)).toEqual(["S1", "S2"]);
    expect(r.orders[0].req.recipient).toMatchObject({ zipCode: "02134", province: "MA" });
    expect(r.orders[1].errors[0]).toMatch(/没有填自定义单号/);
  });

  it("补差金额：-$3.20、+$1.00、(¥5) 都能识别", async () => {
    const { parseAmount } = await import("@/lib/adjustments");
    expect(parseAmount("-$3.20")).toBe(-3.2);
    expect(parseAmount("+$1.00")).toBe(1);
    expect(parseAmount("$-3.20")).toBe(-3.2);
    expect(parseAmount("(¥5)")).toBe(-5);
    expect(parseAmount("USD 12.5")).toBe(12.5);
  });
});

describe("地址识别边角情况", () => {
  it("9 位邮编不带横杠、州名是两个词", async () => {
    const { parseAddress } = await import("@/lib/addressParse");
    expect(parseAddress("John Doe\n1 Main St\nPortland, OR 972011234")).toMatchObject({ city: "Portland", province: "OR", zipCode: "97201-1234" });
    expect(parseAddress("Jane Roe\n10 Elm St\nCharleston\nWest Virginia 25301")).toMatchObject({ city: "Charleston", province: "WV", zipCode: "25301" });
    expect(parseAddress("Amy\n500 Congress Ave\nNew York, NY 10001")).toMatchObject({ city: "New York", province: "NY", zipCode: "10001" });
    expect(parseAddress("Bob\n2 Oak Rd\nAustin, TX 78701-1234")).toMatchObject({ city: "Austin", province: "TX", zipCode: "78701-1234" });
  });
});

describe("收款码", () => {
  it("Zelle 和支付宝收款码分别保存、读取、删除；只收 PNG / JPG", async () => {
    const { saveQr, readQr, deleteQr } = await import("@/lib/topup");
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8ff3f0005fe02fea7d6a4c50000000049454e44ae426082", "hex");
    saveQr("zelle", png);
    expect(readQr("zelle")?.mime).toBe("image/png");
    expect(readQr("alipay")).toBeNull();
    expect(() => saveQr("zelle", Buffer.from("<svg></svg>"))).toThrow(/PNG 或 JPG/);
    deleteQr("zelle");
    expect(readQr("zelle")).toBeNull();
  });
});

describe("客户看到的报价失败原因", () => {
  it("只说大类，不给服务商的原始说明", async () => {
    const { publicQuoteError, publicRowError } = await import("@/lib/portal");
    expect(publicQuoteError("重量段基础费为0，请查看重量段配置是否缺失或者分区价格设置为0，重量为524 oz,分区代码为8")).toBe("不支持该重量或地区");
    expect(publicQuoteError("国家[US],邮编[99501]不通邮")).toBe("地址未覆盖：这个渠道送不到该邮编");
    expect(publicQuoteError("[10024] 包裹重量不在该渠道的下单重量范围内")).toBe("不支持该重量或地区");
    expect(publicQuoteError("单边长度超过限制")).toBe("超出尺寸范围：这个渠道不支持该包裹尺寸");
    expect(publicQuoteError("Logistics product not exist!")).toBe("该渠道暂时无法报价");
    expect(publicRowError("所有渠道都无法报价：重量段基础费为0，分区代码为8")).toBe("所有渠道都无法报价：不支持该重量或地区");
  });
});

describe("地址识别：街道和城市在同一行", () => {
  it("没有逗号 / 有逗号 / 带公寓号", async () => {
    const { parseAddress } = await import("@/lib/addressParse");
    expect(parseAddress("test\n529 S 8th Ave West Bend, WI 53095")).toMatchObject({ address1: "529 S 8th Ave", city: "West Bend", province: "WI", zipCode: "53095" });
    expect(parseAddress("test\n529 S 8th Ave, West Bend, WI 53095")).toMatchObject({ address1: "529 S 8th Ave", city: "West Bend", province: "WI" });
    expect(parseAddress("John Doe\n100 Main St Apt 4 Los Angeles CA 90001")).toMatchObject({ address1: "100 Main St", address2: "Apt 4", city: "Los Angeles", province: "CA" });
    expect(parseAddress("Amy, 12 Pine Rd NW Seattle, WA 98101")).toMatchObject({ address1: "12 Pine Rd NW", city: "Seattle", province: "WA" });
  });
});

describe("地址识别：街道后缀和城市粘在一起", () => {
  it("529 S 8th AveWest Bend, WI 53095", async () => {
    const { parseAddress } = await import("@/lib/addressParse");
    expect(parseAddress("test\n529 S 8th AveWest Bend, WI 53095")).toMatchObject({ address1: "529 S 8th Ave", city: "West Bend", province: "WI", zipCode: "53095" });
    expect(parseAddress("Bob\n10 Main StLos Angeles, CA 90001")).toMatchObject({ address1: "10 Main St", city: "Los Angeles" });
    expect(parseAddress("Amy\n5 Stanley Ave\nAustin, TX 78701")).toMatchObject({ address1: "5 Stanley Ave", city: "Austin" }); // 不误拆 Stanley
  });
});

describe("承运商通用出单错误给客户看中文说明", () => {
  it("LABEL.GENERIC.ERROR", async () => {
    const { publicError } = await import("@/lib/portal");
    const m = publicError('Abnormal purchase of shippinglabel:["We apologize for the inconvenience. This action cannot be completed at this time. Please try again later.(LABEL.GENERIC.ERROR)(来自承运商接口)"]:null(ShipLabel)');
    expect(m).toContain("没有扣费");
  });
});

describe("FedEx 面单默认加印位置", () => {
  it("FedEx 渠道用运单号下面的空白，USPS 不变，其他渠道没有预设", async () => {
    const { presetForChannel, FEDEX_PRESET, USPS_PRESET } = await import("@/lib/stampConfig");
    expect(presetForChannel("Fedex NG末端-N · GDE")).toBe(FEDEX_PRESET);
    expect(presetForChannel("Fedex-Economy-SMP-TY · GDE")).toBe(FEDEX_PRESET);
    expect(FEDEX_PRESET).toMatchObject({ x: 0.2, y: 3.9 });
    expect(FEDEX_PRESET.enabled).toBeUndefined(); // 不强制开启，自动检查 / 全局开关决定
    expect(presetForChannel("USPS-（91710） · SB")).toBe(USPS_PRESET);
    expect(presetForChannel("GOFO-（91710） · SB")).toBeNull();
  });
});
