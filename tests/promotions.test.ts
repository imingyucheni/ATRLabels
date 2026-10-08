import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-promo-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", country: "US", city: "Los Angeles", address1: "1 Main St", zipCode: "90058", province: "CA", phone: "9095550100" },
  recipient: { nameFirst: "Jason", nameLast: "Menard", country: "US", city: "Omaha", address1: "2 Elm St", zipCode: "68104", province: "NE" },
  pkg: { length: 10, width: 8, height: 4, weight: 1, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "A1", productNameCn: "T恤", productNameEn: "T-shirt", quantity: 1, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 10, width: 8, height: 4, weight: 1, unit: 3 }],
};

describe("限时活动价", () => {
  let db: typeof import("@/lib/db");
  let promo: typeof import("@/lib/promotions");
  let svc: typeof import("@/lib/service");
  let cid: number;
  let code: string;
  const today = () => new Date().toLocaleDateString("en-CA");
  const shift = (d: number) => new Date(Date.now() + d * 86400_000).toLocaleDateString("en-CA");

  beforeAll(async () => {
    db = await import("@/lib/db");
    promo = await import("@/lib/promotions");
    svc = await import("@/lib/service");
    await svc.syncChannels();
    code = db.listChannels().filter((c) => !/HWT|MWT/.test(c.name))[0].code;
    cid = db.saveCustomer(null, { name: "活动客户", contact: null, phone: null, email: null, note: null, markup: { percent: 12 } });
    db.setCustomerChannels(cid, [code]);
    const { addLedger } = await import("@/lib/ledger");
    addLedger({ customerId: cid, type: "topup", amount: 100, createdBy: "admin" });
  });

  it("不能设到亏本；活动期间客户价低于成本，显示原价和活动名，客户端看不到返利", async () => {
    const base = { channelCode: code, label: "限时折扣", rebatePercent: 30, startsOn: today(), endsOn: shift(10), enabled: true, note: null };
    expect(promo.validatePromotion({ ...base, customerPercent: -35 })).toMatch(/会亏本/);
    expect(promo.validatePromotion({ ...base, customerPercent: -10 })).toBeNull();
    promo.savePromotion(null, { ...base, customerPercent: -10 });

    const q = (await svc.quoteAll(cid, req)).find((x) => x.channelCode === code && x.ok)!;
    expect(q.rule).toMatchObject({ percent: -10, source: "promo", rebate: 30 });
    expect(q.price!).toBeLessThan(q.cost!);
    expect(q.promo!.originalPrice).toBeGreaterThan(q.price!); // 原价按客户平时的 12%
    expect(q.profit!).toBeCloseTo(q.price! - q.cost! + q.cost! * 0.3, 1);

    const { toPublicQuote } = await import("@/lib/portal");
    const pub = toPublicQuote(q);
    expect(pub.promo).toMatchObject({ label: "限时折扣", endsOn: shift(10) });
    expect(JSON.stringify(pub)).not.toMatch(/rebate/i);

    const id = await svc.createLabel({ customerId: cid, channelCode: code, req, expectedPrice: q.price!, waitForLabel: false });
    const s = db.getShipment(id)!;
    expect(s.rule).toMatchObject({ source: "promo", rebate: 30 });
    expect(db.shipmentProfit(s)!).toBeCloseTo(s.price - s.quotedCost + Math.round(s.quotedCost * 30) / 100, 2);
  });

  it("活动结束 / 停用后恢复原来的加价", async () => {
    const p = promo.listPromotions()[0];
    promo.savePromotion(p.id, { ...p, enabled: false });
    const q = (await svc.quoteAll(cid, req)).find((x) => x.channelCode === code && x.ok)!;
    expect(q.rule).toMatchObject({ percent: 12, source: "customer" });
    expect(q.promo).toBeUndefined();
    promo.savePromotion(p.id, { ...p, enabled: true, startsOn: shift(-20), endsOn: shift(-1) });
    expect(promo.activePromotion(code)).toBeNull();
    expect(promo.promoStatus(promo.getPromotion(p.id)!)).toBe("ended");
  });
});
