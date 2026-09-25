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
