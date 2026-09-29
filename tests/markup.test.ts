import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-markup-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", country: "US", city: "Los Angeles", address1: "1 Main St", zipCode: "90058", province: "CA", phone: "9095550100" },
  recipient: { nameFirst: "Jason", nameLast: "Menard", country: "US", city: "Omaha", address1: "2 Elm St", zipCode: "68104", province: "NE" },
  pkg: { length: 10, width: 8, height: 4, weight: 1, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "A1", productNameCn: "T恤", productNameEn: "T-shirt", quantity: 1, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 10, width: 8, height: 4, weight: 1, unit: 3 }],
};

describe("按渠道加价", () => {
  let db: typeof import("@/lib/db");
  let mk: typeof import("@/lib/markup");
  let svc: typeof import("@/lib/service");
  let cid: number;
  let codes: string[];

  beforeAll(async () => {
    db = await import("@/lib/db");
    mk = await import("@/lib/markup");
    svc = await import("@/lib/service");
    await svc.syncChannels();
    codes = db.listChannels().map((c) => c.code);
    cid = db.saveCustomer(null, { name: "加价客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(cid, codes);
    db.saveSettings({ markup: { percent: 10, fixed: 0, minProfit: 0 } });
  });

  it("四级加价：客户·渠道 > 客户 > 渠道 > 全局，并标明来源", () => {
    const [a, b] = codes;
    expect(mk.effectiveRule(cid, a)).toMatchObject({ percent: 10, source: "global" });
    db.updateChannel(a, true, { percent: 20 });
    expect(mk.effectiveRule(cid, a)).toMatchObject({ percent: 20, source: "channel" });
    expect(mk.effectiveRule(cid, b)).toMatchObject({ percent: 10, source: "global" });
    db.saveCustomer(cid, { name: "加价客户", contact: null, phone: null, email: null, note: null, markup: { percent: 15 } });
    expect(mk.effectiveRule(cid, a)).toMatchObject({ percent: 15, source: "customer" });
    mk.setCustomerChannelMarkups(cid, { [a]: { percent: 30, fixed: 0.5 } });
    expect(mk.effectiveRule(cid, a)).toMatchObject({ percent: 30, fixed: 0.5, source: "customer_channel" });
    expect(mk.effectiveRule(cid, b)).toMatchObject({ percent: 15, source: "customer" }); // 其他渠道不受影响
    // 重新保存开通的渠道，不会把专属加价清掉
    db.setCustomerChannels(cid, codes);
    expect(mk.effectiveRule(cid, a).percent).toBe(30);
    // 清空 = 沿用上一级
    mk.setCustomerChannelMarkups(cid, { [a]: { percent: null, fixed: null, minProfit: null } });
    expect(mk.effectiveRule(cid, a)).toMatchObject({ percent: 15, source: "customer" });
  });

  it("修改都有记录；订单记下下单时用的比例和来源", async () => {
    const log = mk.listMarkupLog({ customerId: cid });
    expect(log.length).toBe(2);
    expect(log[1]).toMatchObject({ scope: "customer_channel", after: { percent: 30, fixed: 0.5, minProfit: null } });
    expect(mk.describeRule(log[1].after)).toBe("+30% · +$0.50 · 最低利润 沿用");

    const [a] = codes;
    mk.setCustomerChannelMarkups(cid, { [a]: { percent: 40 } });
    db.saveCustomer(cid, { name: "加价客户", contact: null, phone: null, email: null, note: null, markup: {} });
    const { addLedger } = await import("@/lib/ledger");
    addLedger({ customerId: cid, type: "topup", amount: 100, createdBy: "admin" });
    const q = (await svc.quoteAll(cid, req)).find((x) => x.ok && x.channelCode === a)!;
    expect(q.price).toBeCloseTo(Math.ceil(q.cost! * 1.4 * 100 - 1e-6) / 100, 1);
    const id = await svc.createLabel({ customerId: cid, channelCode: a, req, expectedPrice: q.price!, waitForLabel: false });
    expect(db.getShipment(id)!.rule).toMatchObject({ percent: 40, source: "customer_channel" });
  });
});
