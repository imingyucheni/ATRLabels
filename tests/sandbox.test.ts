import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FeeQuote, ShipmentRequest } from "@/lib/shipbest/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atr-sandbox-"));
process.env.DATA_DIR = dir;
delete process.env.SHIPBEST_MOCK;

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", country: "US", city: "Chino", address1: "1 Main St", zipCode: "91710", province: "CA" },
  recipient: { nameFirst: "Jane", nameLast: "Roe", country: "US", city: "Austin", address1: "2 Elm St", zipCode: "78701", province: "TX" },
  pkg: { length: 10, width: 8, height: 4, weight: 1, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [],
};

const realQuote: FeeQuote = {
  logisticsProductId: 9, logisticsProductName: "GOFO-（91710）", baseShippingFee: 6.12, baseDiscountShippingFee: 6.12,
  extraShippingFee: 0, extraDiscountShippingFee: 0, totalShippingFee: 6.12, totalDiscountShippingFee: 6.12, currency: "USD", zone: "zone8",
};

describe("接口模式 / 沙盒", () => {
  let db: typeof import("@/lib/db");
  let sb: typeof import("@/lib/shipbest/client");

  beforeAll(async () => {
    db = await import("@/lib/db");
    sb = await import("@/lib/shipbest/client");
  });

  afterEach(() => {
    delete process.env.APP_ENV;
    vi.useRealTimers();
  });

  it("按设置选择模式；沙盒站不允许正式模式", () => {
    db.saveSettings({ shipbest: { mode: "mock", apiId: "", token: "" } });
    expect(sb.shipbestMode()).toBe("mock");
    expect(sb.isTestMode()).toBe(true);
    db.saveSettings({ shipbest: { mode: "live", apiId: "id", token: "tok" } });
    expect(sb.shipbestMode()).toBe("live");
    expect(sb.isTestMode()).toBe(false);
    process.env.APP_ENV = "sandbox";
    expect(sb.shipbestMode()).toBe("sandbox");
    expect(sb.getShipBestClient()).toBeInstanceOf(sb.SandboxShipBestClient);
  });

  it("沙盒和正式模式没有账号时报错", () => {
    db.saveSettings({ shipbest: { mode: "sandbox", apiId: "", token: "" } });
    expect(() => sb.getShipBestClient()).toThrow(/API ID/);
  });

  it("沙盒：报价走真实接口，下单 / 面单 / 取消是模拟的", async () => {
    const calls: string[] = [];
    const real = {
      verify: async () => void calls.push("verify"),
      getProducts: async () => (calls.push("products"), [{ code: "LP1", name: "GOFO-（91710）" }]),
      trialPrice: async () => (calls.push("trial"), realQuote),
      createOrder: async () => { throw new Error("不应该真实下单"); },
      getOrder: async () => { throw new Error("不应该查真实订单"); },
      cancelOrder: async () => { throw new Error("不应该真实取消"); },
    } as unknown as import("@/lib/shipbest/client").HttpShipBestClient;
    const c = new sb.SandboxShipBestClient(real);
    expect(await c.getProducts()).toEqual([{ code: "LP1", name: "GOFO-（91710）" }]);
    expect((await c.trialPrice("LP1", req))!.totalDiscountShippingFee).toBe(6.12);

    await c.createOrder("T-1", "LP1", req);
    await expect(c.createOrder("T-1", "LP1", req)).rejects.toThrow(/repeat/);
    const o = await c.getOrder({ customNo: "T-1" });
    expect(o.feePrice).toBe(6.12); // 用的是真实报价
    expect(o.status).toBe(2);

    // 1 秒后模拟出单；换一个新的客户端实例（相当于服务器重启）也能查到
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5000);
    const again = new sb.SandboxShipBestClient(real);
    const done = await again.getOrder({ customNo: "T-1" });
    expect(done.status).toBe(4);
    expect(done.labelUrl).toMatch(/^mock:\/\//);
    await expect(again.cancelOrder({ customNo: "T-1" })).rejects.toThrow(/nonsupport/);

    await c.createOrder("T-2", "LP1", req);
    await c.cancelOrder({ customNo: "T-2" });
    expect((await new sb.MockShipBestClient().getOrder({ customNo: "T-2" })).status).toBe(6);
    expect(calls).toEqual(["products", "trial", "trial", "trial"]);
  });
});

describe("清除模拟 / 沙盒数据", () => {
  it("只删测试单及其扣款、补差，正式单、充值和客户保留", async () => {
    const db = await import("@/lib/db");
    const ledger = await import("@/lib/ledger");
    const { clearTestData, testDataStats, hasTestData } = await import("@/lib/cleanup");
    const id = db.saveCustomer(null, { name: "清空测试客户", contact: null, phone: null, email: null, note: null, markup: {} });
    ledger.addLedger({ customerId: id, type: "topup", amount: 50, createdBy: "admin" });
    // 充值申请（引用流水）、订单 + 扣款、补差，覆盖所有外键关系
    const topup = await import("@/lib/topup");
    const tid = await topup.createTopup({ customerId: id, method: "zelle", amountUsd: 20, reference: "T1" });
    topup.approveTopup(tid, 20, null);
    const ins = (no: string, env: string, price: number) =>
      Number(db.db().prepare(`INSERT INTO shipments (custom_no, customer_id, channel_code, sender_json, recipient_json, package_json, sku_json, quoted_cost, currency, price, rule_json, status, env) VALUES (?, ?, 'X', '{}', '{}', '{}', '[]', 1, 'USD', ?, '{}', 'labeled', ?)`).run(no, id, price, env).lastInsertRowid);
    const sid = ins("M1", "mock", 2);
    ledger.addLedger({ customerId: id, type: "label", amount: -2, shipmentId: sid, createdBy: "admin" });
    const sb2 = ins("S1", "sandbox", 3);
    ledger.addLedger({ customerId: id, type: "label", amount: -3, shipmentId: sb2, createdBy: "admin" });
    // 分开环境之前的老数据：没有记录模式、也没有面单地址 → 算测试单
    const old = Number(db.db().prepare("INSERT INTO shipments (custom_no, customer_id, channel_code, sender_json, recipient_json, package_json, sku_json, quoted_cost, currency, price, rule_json, status) VALUES ('O1', ?, 'X', '{}', '{}', '{}', '[]', 1, 'USD', 1, '{}', 'pending')").run(id).lastInsertRowid);
    const live = ins("L1", "live", 5);
    ledger.addLedger({ customerId: id, type: "label", amount: -5, shipmentId: live, createdBy: "admin" });
    const bid = Number(db.db().prepare("INSERT INTO adjustment_batches (filename, file_hash, policy) VALUES ('a.csv', 'h1', 'at_cost')").run().lastInsertRowid);
    const aid = Number(db.db().prepare("INSERT INTO adjustments (batch_id, row_no, match_key, shipment_id, customer_id, cost_amount, customer_amount) VALUES (?, 2, 'M1', ?, ?, 0.5, 0.5)").run(bid, sid, id).lastInsertRowid);
    ledger.postAdjustment(aid, id, sid, 0.5, "重量调整");
    const aid2 = Number(db.db().prepare("INSERT INTO adjustments (batch_id, row_no, match_key, shipment_id, customer_id, cost_amount, customer_amount) VALUES (?, 3, 'L1', ?, ?, 0.4, 0.4)").run(bid, live, id).lastInsertRowid);
    ledger.postAdjustment(aid2, id, live, 0.4, "重量调整");
    expect(ledger.balanceOf(id)).toBeCloseTo(50 + 20 - 2 - 3 - 5 - 0.5 - 0.4, 2);

    const st = testDataStats();
    expect(st.liveShipments).toBeGreaterThanOrEqual(1);
    expect(st.testShipments).toBeGreaterThanOrEqual(2);
    const r = clearTestData();
    expect(r.backup).toMatch(/^before-clear-.*\.db$/);
    // 充值保留，只退掉测试单的扣款和补差；正式单和它的补差不动
    expect(ledger.balanceOf(id)).toBeCloseTo(50 + 20 - 5 - 0.4, 2);
    expect(db.getShipment(live)).toBeTruthy();
    expect(db.getShipment(sid)).toBeNull();
    expect(db.getShipment(sb2)).toBeNull();
    expect(db.getShipment(old)).toBeNull();
    expect(db.db().prepare("SELECT COUNT(*) AS n FROM adjustments WHERE batch_id = ?").get(bid)).toEqual({ n: 1 });
    expect(db.getCustomer(id)?.name).toBe("清空测试客户");
    expect(hasTestData()).toBe(false);
    expect(() => clearTestData()).toThrow(/没有需要清除/);
  });
});
