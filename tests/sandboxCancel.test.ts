import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FeeQuote, ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-sandbox-cancel-"));
process.env.ATR_SINGLE_DB = "1";
delete process.env.SHIPBEST_MOCK;

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", phone: "9095550100", country: "US", city: "Chino", address1: "1 Main St", zipCode: "91710", province: "CA" },
  recipient: { nameFirst: "Jane", nameLast: "Roe", country: "US", city: "Austin", address1: "2 Elm St", zipCode: "78701", province: "TX" },
  pkg: { length: 10, width: 8, height: 4, weight: 1, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "S1", productNameCn: "T恤", productNameEn: "Shirt", quantity: 1, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 10, width: 8, height: 4, weight: 1, unit: 3 }],
};

const quote: FeeQuote = {
  logisticsProductId: 1, logisticsProductName: "GOFO", baseShippingFee: 5, baseDiscountShippingFee: 5,
  extraShippingFee: 0, extraDiscountShippingFee: 0, totalShippingFee: 5, totalDiscountShippingFee: 5, currency: "USD", zone: "zone5",
};

describe("沙盒 / 模拟：嘉谷、DHL 的模拟单出面单后也能取消", () => {
  let db: typeof import("@/lib/db");
  let sb: typeof import("@/lib/shipbest/client");
  let log: typeof import("@/lib/providerLog");

  beforeAll(async () => {
    db = await import("@/lib/db");
    sb = await import("@/lib/shipbest/client");
    log = await import("@/lib/providerLog");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.APP_ENV;
  });

  it("沙盒客户端：JG / DHL 模拟单已打单也能取消（记一条“模拟取消”）；ShipBest 的单保留真实规则，说明里写明是模拟单", async () => {
    const real = {
      verify: async () => {},
      getProducts: async () => [],
      trialPrice: async () => quote,
      createOrder: async () => { throw new Error("不应该真实下单"); },
      getOrder: async () => { throw new Error("不应该查真实订单"); },
      cancelOrder: async () => { throw new Error("不应该真实取消"); },
    } as unknown as import("@/lib/shipbest/client").HttpShipBestClient;
    const c = new sb.SandboxShipBestClient(real);
    await c.createOrder("SX-JG", "JG-579181", req);
    await c.createOrder("SX-DHL", "DHL-P", req);
    await c.createOrder("SX-SB", "LP1", req);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 5000);
    for (const no of ["SX-JG", "SX-DHL", "SX-SB"]) expect((await c.getOrder({ customNo: no })).status).toBe(4);

    await c.cancelOrder({ customNo: "SX-JG" });
    expect((await c.getOrder({ customNo: "SX-JG" })).status).toBe(6);
    expect(log.listProviderEvents("SX-JG").find((e) => e.action === "模拟取消")).toMatchObject({ provider: "嘉谷", message: "模拟订单（沙盒 / 模拟模式）：直接取消成功，没有连接嘉谷" });
    await c.cancelOrder({ customNo: "SX-DHL" });
    expect((await c.getOrder({ customNo: "SX-DHL" })).status).toBe(6);
    expect(log.listProviderEvents("SX-DHL").find((e) => e.action === "模拟取消")?.provider).toBe("DHL");

    // ShipBest：和真实一样，已打单要人工取消；报错里写明是模拟单
    const err = await c.cancelOrder({ customNo: "SX-SB" }).catch((e) => e);
    expect(err).toBeInstanceOf(sb.ShipBestError);
    expect(err.code).toBe(11203);
    expect(err.message).toMatch(/模拟订单/);
    expect(err.message).toMatch(/nonsupport/);
    // 已取消的再取消：照旧报“不能重复取消”
    await expect(c.cancelOrder({ customNo: "SX-JG" })).rejects.toThrow(/11204/);
  });

  it("沙盒站：嘉谷渠道的单出面单后申请取消，直接取消退款（不再变成“请联系嘉谷人工取消”）", async () => {
    process.env.APP_ENV = "sandbox";
    db.saveSettings({
      shipbest: { mode: "sandbox", apiId: "id", token: "tok" },
      jiagu: { enabled: true, clientId: "id", secret: "s", ownershipId: "1001", customerId: "2002", warehouseId: "", warehouses: {} },
    });
    const jgCalls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/connect/token") return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      jgCalls.push(u.pathname);
      if (u.pathname === "/api/gts/CalculateRates") return new Response(JSON.stringify({ IsSuccess: true, Result: [{ ID: 579181, ProductName: "GOFO", TotalCharge: 5, RatesList: [{ Currency: "USD", ZoneCode: "5", Amount: 5 }] }] }));
      return new Response(JSON.stringify({ IsSuccess: false, Message: "沙盒不应该调用这个接口" }));
    });
    expect(sb.shipbestMode()).toBe("sandbox");
    const svc = await import("@/lib/service");
    const cid = db.saveCustomer(null, { name: "沙盒客户", contact: null, phone: null, email: null, note: null, markup: {} });
    const id = db.insertShipment({
      customNo: "SBX-1", customerId: cid, channelCode: "JG-579181", channelName: "GOFO · GDE", sender: req.sender, recipient: req.recipient, pkg: req.pkg, skuList: req.skuList,
      quotedCost: 5, currency: "USD", zone: null, price: 6, rule: { percent: 0, fixed: 1, minProfit: 0 }, remark: null, customerRef: "SBX-REF", createdBy: "admin", env: "sandbox", addressCheck: null,
    });
    await sb.getShipBestClient().createOrder("SBX-1", "JG-579181", req);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 5000);
    expect((await svc.refreshShipment(id)).status).toBe("labeled");
    const r = await svc.requestCancel(id);
    expect(r.done).toBe(true);
    expect(db.getShipment(id)).toMatchObject({ status: "cancelled" });
    // 只报过价，没有调嘉谷的下单 / 作废接口
    expect(jgCalls.every((p) => p === "/api/gts/CalculateRates")).toBe(true);
  });
});
