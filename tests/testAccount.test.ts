import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-testacct-"));
process.env.ATR_SINGLE_DB = "1";
delete process.env.SHIPBEST_MOCK;

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", country: "US", city: "Chino", address1: "1 Main St", zipCode: "91710", province: "CA", phone: "9095550100" },
  recipient: { nameFirst: "Jane", nameLast: "Roe", country: "US", city: "Austin", address1: "2 Elm St", zipCode: "78701", province: "TX" },
  pkg: { length: 10, width: 8, height: 4, weight: 1, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "S1", productNameCn: "T恤", productNameEn: "Shirt", quantity: 1, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 10, width: 8, height: 4, weight: 1, unit: 3 }],
};

describe("内部测试账号（正式模式下）", () => {
  const calls: string[] = [];
  beforeAll(async () => {
    const db = await import("@/lib/db");
    db.saveSettings({ shipbest: { mode: "live", apiId: "fake-id", token: "fake-token" } });
    db.upsertChannels([{ code: "LP-UNI", name: "UniUni-（91710） · SB" }]);
    vi.stubGlobal("fetch", async (url: string) => {
      const p = new URL(url).pathname;
      calls.push(p);
      if (p === "/api/logistics/trialOrderPrice") return new Response(JSON.stringify({ code: 0, data: { orderFeeCalcVos: [{ logisticsProductCode: "LP-UNI", totalShippingFee: "5.00", totalDiscountShippingFee: "4.00", currency: "USD" }] } }));
      return new Response(JSON.stringify({ code: 99999, message: "不应该调用真实下单接口" }));
    });
  });
  afterEach(() => { calls.length = 0; });

  it("报价是真实的；下单、查询、取消都是模拟的，不调服务商下单接口；不计入报表营收；可以清除", async () => {
    const db = await import("@/lib/db");
    const svc = await import("@/lib/service");
    const ledger = await import("@/lib/ledger");
    const { buildReport } = await import("@/lib/reports");
    const { clearTestData } = await import("@/lib/cleanup");
    const cid = db.saveCustomer(null, { name: "自己人测试", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(cid, ["LP-UNI"]);
    db.setTestAccount(cid, true);
    ledger.addLedger({ customerId: cid, type: "topup", amount: 50, createdBy: "admin" });
    const q = (await svc.quoteAll(cid, req)).find((x) => x.ok)!;
    expect(q.cost).toBe(4); // 真实报价
    const id = await svc.createLabel({ customerId: cid, channelCode: q.channelCode, req, expectedPrice: q.price!, waitForLabel: false });
    expect(calls).not.toContain("/api/order/create");
    await new Promise((r) => setTimeout(r, 1100)); // 模拟面单 1 秒后生成
    const s = await svc.refreshShipment(id);
    expect(s.isTest).toBe(true);
    expect(s.status).toBe("labeled"); // 模拟面单
    expect(calls.some((c) => c.startsWith("/api/order"))).toBe(false);
    const today = new Date().toLocaleDateString("en-CA");
    expect(buildReport(today, today).totals).toMatchObject({ orders: 0 });
    expect(buildReport(today, today).topups).toBe(0);
    const r = await svc.requestCancel(id);
    expect(r.done).toBe(true);
    expect(calls.some((c) => c.startsWith("/api/order"))).toBe(false);
    clearTestData();
    expect(db.getShipment(id)).toBeFalsy();
  });
});
