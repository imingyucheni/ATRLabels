import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-auditfix-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", country: "US", city: "Chino", address1: "1 Main St", zipCode: "91710", province: "CA", phone: "9095550100" },
  recipient: { nameFirst: "Jane", nameLast: "Roe", country: "US", city: "Austin", address1: "500 Congress Ave", zipCode: "78701", province: "TX", phone: "5125550100" },
  pkg: { length: 10, width: 8, height: 4, weight: 1, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "A1", productNameCn: "T恤", productNameEn: "T-shirt", quantity: 1, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 10, width: 8, height: 4, weight: 1, unit: 3 }],
};
const today = () => new Date().toLocaleDateString("en-CA");
const shift = (d: number) => new Date(Date.now() + d * 86400_000).toLocaleDateString("en-CA");

describe("全面检查后修复的问题", () => {
  let db: typeof import("@/lib/db");
  let svc: typeof import("@/lib/service");
  let mk: typeof import("@/lib/markup");
  let promo: typeof import("@/lib/promotions");
  let ledger: typeof import("@/lib/ledger");
  let codes: string[];
  const cust = (name: string, percent: number | null = null) => db.saveCustomer(null, { name, contact: null, phone: null, email: null, note: null, markup: { percent } });

  beforeAll(async () => {
    db = await import("@/lib/db");
    svc = await import("@/lib/service");
    mk = await import("@/lib/markup");
    promo = await import("@/lib/promotions");
    ledger = await import("@/lib/ledger");
    db.saveSettings({ markup: { percent: 10, fixed: 0, minProfit: 0 }, roundingStep: 0.01 });
    await svc.syncChannels();
    codes = db.listChannels().filter((c) => !/HWT|MWT/.test(c.name) && !c.code.startsWith("DHL")).map((c) => c.code);
  });

  it("限时活动只会让价格更低：本来更便宜的客户（谈好的负数加价）活动期间价格不变、不显示活动", async () => {
    const code = codes[0];
    db.setChannelRebate(code, 30);
    const vip = cust("大客户");
    const normal = cust("普通客户", 12);
    db.setCustomerChannels(vip, [code]);
    db.setCustomerChannels(normal, [code]);
    mk.setCustomerChannelMarkups(vip, { [code]: { percent: -25 } });
    const before = await svc.quoteChannel(vip, code, req);
    promo.savePromotion(null, { channelCode: code, label: "限时折扣", rebatePercent: 30, customerPercent: -10, startsOn: today(), endsOn: shift(5), enabled: true, note: null });
    svc.clearQuoteCache();
    const v = await svc.quoteChannel(vip, code, req);
    expect(v.price).toBe(before.price);
    expect(v.rule?.source).toBe("customer_channel");
    expect(v.promo).toBeUndefined();
    const n = await svc.quoteChannel(normal, code, req);
    expect(n.rule?.source).toBe("promo");
    expect(n.promo?.originalPrice).toBeGreaterThan(n.price!);
    // 活动日期不能和已有活动重叠
    expect(promo.validatePromotion({ channelCode: code, label: "又一个", rebatePercent: 30, customerPercent: -5, startsOn: shift(2), endsOn: shift(9), enabled: true, note: null })).toMatch(/日期不能重叠/);
    for (const p of promo.listPromotions()) promo.deletePromotion(p.id);
    db.setChannelRebate(code, 0);
  });

  it("新客户试算和真实客户一样算：渠道长期返利能兜住负数加价", async () => {
    const code = codes[1];
    db.setChannelRebate(code, 30);
    svc.clearQuoteCache();
    const q = (await svc.quoteForProspect(req, { percent: -20 })).find((x) => x.channelCode === code)!;
    expect(q.ok).toBe(true);
    expect(q.price!).toBeLessThan(q.cost!);
    expect(q.rule).toMatchObject({ percent: -20, rebate: 30 });
    db.setChannelRebate(code, 0);
  });

  it("补差：负数加价的单，附加费至少按成本转给客户", async () => {
    const { customerAmountFor } = await import("@/lib/adjustments");
    expect(customerAmountFor(10, "with_markup", { percent: -10, fixed: 0, minProfit: 0 })).toBe(10);
    expect(customerAmountFor(10, "with_markup", { percent: 5, fixed: 0, minProfit: 0 })).toBe(10.5);
  });

  it("充值汇率：页面传来的更低汇率只有服务器最近真报过才接受", async () => {
    const { createTopup, getTopup } = await import("@/lib/topup");
    const { usdCnyQuote } = await import("@/lib/fx");
    const c = cust("充值客户");
    db.saveSettings({ fxMode: "manual", fxManualRate: 7.3, fxMarkup: 0.03 });
    await usdCnyQuote(); // 页面显示 7.33
    const forged = await createTopup({ customerId: c, method: "alipay", amountUsd: 1000, reference: "R1", quotedRate: 7.25 });
    expect(getTopup(forged)!.fxRate).toBe(7.33);
    // 汇率刚涨到 7.40，客户按刚才页面上的 7.33 付款：接受
    db.saveSettings({ fxManualRate: 7.37 });
    const shown = await createTopup({ customerId: c, method: "alipay", amountUsd: 1000, reference: "R2", quotedRate: 7.33 });
    expect(getTopup(shown)!.fxRate).toBe(7.33);
  });

  it("恢复遗留负数加价时跳过限时活动的记录", () => {
    const ch = codes[2];
    db.updateChannel(ch, true, { percent: 15 });
    mk.logMarkupChange({ scope: "channel", channelCode: ch, label: "渠道", before: null, after: { percent: 15 } });
    mk.logMarkupChange({ scope: "channel", channelCode: ch, label: "渠道", before: { percent: 15 }, after: { percent: -10 } });
    db.updateChannel(ch, true, { percent: -10 });
    mk.logMarkupChange({ scope: "channel", channelCode: ch, label: "限时活动 #9「限时折扣」", before: null, after: { percent: -10 } });
    expect(mk.leftoverNegativeMarkups().find((x) => x.channelCode === ch)?.restorePercent).toBe(15);
    mk.restoreLeftoverNegativeMarkups();
    expect(db.getChannel(ch)?.markup?.percent).toBe(15);
    db.updateChannel(ch, true, {});
  });

  it("API 测试单不占正式订单号、不进对账单；没退款的异常单要进对账单", async () => {
    const { buildStatement } = await import("@/lib/statement");
    const code = codes[0];
    const c = cust("对账客户");
    db.setCustomerChannels(c, [code]);
    ledger.addLedger({ customerId: c, type: "topup", amount: 100, createdBy: "admin" });
    const q = await svc.quoteChannel(c, code, req);
    const t = await svc.createLabel({ customerId: c, channelCode: code, req, expectedPrice: q.price!, customerRef: "SO-1", simulate: true, waitForLabel: false });
    const l = await svc.createLabel({ customerId: c, channelCode: code, req, expectedPrice: q.price!, customerRef: "SO-1", waitForLabel: false });
    expect(l).not.toBe(t);
    const ex = await svc.createLabel({ customerId: c, channelCode: code, req, expectedPrice: q.price!, customerRef: "SO-2", waitForLabel: false });
    db.updateShipment(ex, { status: "exception", errorMsg: "测试异常" });
    const st = buildStatement(c)!;
    const refs = st.lines.map((x) => x.customerRef);
    expect(refs.filter((r) => r === "SO-1").length).toBe(1);
    expect(st.lines.find((x) => x.shipmentId === t)).toBeUndefined();
    expect(st.lines.find((x) => x.shipmentId === ex)?.amount).toBeCloseTo(q.price!, 2);
  });

  it("同一张单不能同时取消两次；已经退过款的不能再确认取消", async () => {
    const code = codes[0];
    const c = cust("取消客户");
    db.setCustomerChannels(c, [code]);
    ledger.addLedger({ customerId: c, type: "topup", amount: 100, createdBy: "admin" });
    const q = await svc.quoteChannel(c, code, req);
    const id = await svc.createLabel({ customerId: c, channelCode: code, req, expectedPrice: q.price!, customerRef: "CX-1", waitForLabel: false });
    const [a, b] = await Promise.all([svc.requestCancel(id), svc.requestCancel(id)]);
    expect([a.message, b.message].some((m) => /正在取消/.test(m))).toBe(true);
    // 模拟“取消处理中”但其实已经退过款的情况
    if (db.getShipment(id)!.status === "cancelled") {
      db.updateShipment(id, { status: "cancel_requested" });
      expect(() => svc.confirmCancelled(id, 0, 0)).toThrow(/已经退过款/);
    }
  });

  it("DHL / 嘉谷渠道申报价值只能用美元", async () => {
    db.upsertChannels([{ code: "JG-579181", name: "GOFO-LAX-917 · GDE" }]);
    const c = cust("币种客户");
    db.setCustomerChannels(c, ["JG-579181"]);
    const cny = { ...req, skuList: req.skuList.map((k) => ({ ...k, declaredCurrency: "CNY" })) };
    await expect(svc.createLabel({ customerId: c, channelCode: "JG-579181", req: cny, expectedPrice: 1, waitForLabel: false })).rejects.toThrow(/只能用美元/);
  });

  it("报表不把公司自用（成本价）的单算成营收", async () => {
    const { buildReport } = await import("@/lib/reports");
    const house = db.houseCustomerId();
    const code = codes[0];
    // 模拟模式下的单都算测试单，这里带上测试单一起看
    const all = { includeTest: true };
    const before = buildReport(today(), today(), undefined, all).totals.orders;
    const q = await svc.quoteChannel(house, code, req);
    await svc.createLabel({ customerId: house, channelCode: code, req, expectedPrice: q.price!, waitForLabel: false });
    expect(buildReport(today(), today(), undefined, all).totals.orders).toBe(before);
    expect(buildReport(today(), today(), house, all).totals.orders).toBeGreaterThan(0);
  });

  describe("开放 API", () => {
    let v1: typeof import("@/lib/api/v1");
    let c: number;
    const key = (mode: "live" | "test") => ({ id: 1, customerId: c, mode }) as unknown as import("@/lib/api/keys").ApiKey;
    const shipTo = { name: "Jane Roe", phone: "5125550100", address1: "500 Congress Ave", city: "Austin", state: "TX", postalCode: "78701", country: "US" };
    const pkg = { length: 10, width: 8, height: 4, weight: 1.5, unit: "in/lb" };

    beforeAll(async () => {
      v1 = await import("@/lib/api/v1");
      const terms = await import("@/lib/terms");
      db.saveSettings({ sender: { nameFirst: "ATR", nameLast: "Warehouse", country: "US", province: "CA", city: "Chino", address1: "13950 Central Ave", zipCode: "91710", phone: "9095550100" } });
      c = cust("API 修复客户");
      db.setCustomerChannels(c, [codes[0]]);
      ledger.addLedger({ customerId: c, type: "topup", amount: 100, createdBy: "admin" });
      terms.acceptTerms({ customerId: c, party: terms.partyOf(db.getCustomer(c)!), signer: "Amy", signerTitle: "Owner", lang: "zh", ip: null, userAgent: null });
    });

    it("同一个 referenceNo 同时提交两次：只出一单，两次都返回这一单", async () => {
      const body = { referenceNo: "RACE-1", channel: codes[0], shipTo, package: pkg, addressConfirmed: true };
      const before = ledger.balanceOf(c);
      const [a, b] = await Promise.all([v1.createOrder(key("live"), body, "https://x"), v1.createOrder(key("live"), body, "https://x")]);
      expect([a.created, b.created].sort()).toEqual([false, true]);
      expect(a.order.orderNo).toBe(b.order.orderNo);
      expect(ledger.balanceOf(c)).toBeCloseTo(before - a.order.price, 2);
    });

    it("测试密钥下过的订单号，正式密钥照常下单；查单两边分开", async () => {
      const body = { referenceNo: "BOTH-1", channel: codes[0], shipTo, package: pkg, addressConfirmed: true };
      const t = await v1.createOrder(key("test"), body, "https://x");
      const l = await v1.createOrder(key("live"), body, "https://x");
      expect(t.order.test).toBe(true);
      expect(l.created).toBe(true);
      expect(l.order.test).toBe(false);
      expect((await v1.getOrder(key("live"), "BOTH-1", "https://x")).orderNo).toBe(l.order.orderNo);
      expect((await v1.getOrder(key("test"), "BOTH-1", "https://x")).orderNo).toBe(t.order.orderNo);
    });

    it("国际件必须填申报价值和数量", () => {
      expect(() => v1.toShipmentRequest(c, { shipTo: { ...shipTo, country: "CA", state: "ON", postalCode: "M5V 2T6", city: "Toronto" }, package: pkg, items: [{ name: "Shirt", hsCode: "610910" }] } as never)).toThrow(/unitValue 必填/);
    });

    it("异常单的错误说明不带服务商原话", async () => {
      const r = await v1.createOrder(key("live"), { referenceNo: "EX-API", channel: codes[0], shipTo, package: pkg, addressConfirmed: true }, "https://x");
      const s = db.listShipments({ customerId: c }).find((x) => x.customerRef === "EX-API")!;
      db.updateShipment(s.id, { status: "exception", errorMsg: "嘉谷 5 分钟内未出面单：请客户联系我们或换其他渠道重新下单，并联系嘉谷处理；处理完在这里取消（未出面单全额退款）" });
      const o = await v1.getOrder(key("live"), r.order.orderNo, "https://x").catch(() => null);
      const view = o ?? (await v1.getOrder(key("live"), "EX-API", "https://x"));
      expect(JSON.stringify(view)).not.toMatch(/嘉谷/);
    });
  });
});
