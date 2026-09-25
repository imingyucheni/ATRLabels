import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atr-jiagu-"));
process.env.DATA_DIR = dir;
process.env.ATR_SINGLE_DB = "1";
delete process.env.SHIPBEST_MOCK;

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", phone: "9095550100", country: "US", city: "Chino", address1: "1 Main St", zipCode: "91710", province: "CA" },
  recipient: { nameFirst: "Jane", nameLast: "Roe", country: "US", city: "Austin", address1: "2 Elm St", zipCode: "78701", province: "TX" },
  pkg: { length: 10, width: 8, height: 4, weight: 1.5, displayUnitSystem: 3, signServiceType: 3, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "SKU-1", productNameCn: "T恤", productNameEn: "T-Shirt", quantity: 2, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "", productNature: "", length: 1, width: 1, height: 1, weight: 1, unit: 3 }],
};

/** 假的嘉谷服务器：记录请求，按路径返回 */
function fakeServer(handlers: Record<string, (body: Record<string, unknown>) => unknown>) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const u = new URL(url);
    if (u.pathname === "/connect/token") return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    const body = JSON.parse(String(init.body ?? "{}"));
    calls.push({ path: u.pathname, body });
    const h = handlers[u.pathname];
    return new Response(JSON.stringify(h ? h(body) : { IsSuccess: false, Message: "no handler" }));
  });
  return calls;
}

describe("嘉谷万邑接口", () => {
  let db: typeof import("@/lib/db");
  let jg: typeof import("@/lib/shipbest/jiagu");
  let sb: typeof import("@/lib/shipbest/client");

  beforeAll(async () => {
    db = await import("@/lib/db");
    jg = await import("@/lib/shipbest/jiagu");
    sb = await import("@/lib/shipbest/client");
    db.saveSettings({
      shipbest: { mode: "live", apiId: "", token: "" },
      jiagu: { enabled: true, clientId: "id", secret: "s", ownershipId: "1001", customerId: "2002", warehouseId: "", warehouses: { "111": "999" } },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("请求体：单位、签名、收件电话、每个渠道的仓库", () => {
    const cfg = jg.jiaguConfig()!;
    const b = jg.buildJiaguBody(cfg, req, 579181);
    expect(b.WarehouseID).toBe(196845); // 默认表里 GOFO 的仓库
    expect(jg.buildJiaguBody(cfg, req, 111).WarehouseID).toBe(999); // 后台设置的
    expect(b.OrderType).toBe(20120);
    expect(b.NeedSignService).toBe("10"); // 成人签名
    expect(b.ShipToPhone).toBe("9095550100"); // 收件人没电话时用寄件人电话
    expect(b.Packages[0]).toMatchObject({ Weight: 1.5, WeightUnit: "LB", LengthUnit: "IN", Qty: 2, DeclareValue: 5, SKU: "SKU-1" });
    const metric = jg.buildJiaguBody(cfg, { ...req, pkg: { ...req.pkg, weight: 800, displayUnitSystem: 1 } }, 579181);
    expect(metric.Packages[0]).toMatchObject({ Weight: 0.8, WeightUnit: "KG", LengthUnit: "CM" });
  });

  it("渠道、报价（不通邮 / 失败）、下单、查面单、取消都走嘉谷", async () => {
    const calls = fakeServer({
      "/api/gts/ListProductSubscribe": () => ({ IsSuccess: true, Result: [{ ID: 579181, ProductName: "GOFO-LAX-917(不预上网)" }, { ID: 307699, ProductName: "uniuni-LAX-917(不预上网)" }] }),
      "/api/gts/CalculateRates": (b) => {
        const id = (b.Products as { ID: number }[])[0].ID;
        return id === 307699
          ? { IsSuccess: true, Result: [{ ID: id, TotalCharge: 0, Message: "订单未匹配到分区" }] }
          : { IsSuccess: true, Result: [{ ID: id, ProductName: "GOFO", TotalCharge: 5.39, RatesList: [{ Currency: "USD", ZoneCode: "8", Amount: 5.39 }] }] };
      },
      "/api/gts/ShippingLabel": () => ({ IsSuccess: false, ErrorCode: "100", Message: "供应商异步未及时返回单号" }),
      "/api/gts/GetMailNoByOrderNbr": () => ({ IsSuccess: true, Result: { TrackingNbr: "GFUS123", WaybillUrl: "http://x/label.pdf" } }),
      "/api/gts/VoidShipment": () => ({ IsSuccess: true, Result: true }),
    });
    const client = sb.getShipBestClient();
    const products = await client.getProducts();
    expect(products.map((p) => p.code)).toEqual(["JG-579181", "JG-307699"]);
    expect(products[0].name).toBe("GOFO-LAX-917(不预上网) · 嘉谷");
    db.upsertChannels(products);

    const q = await client.trialPrice("JG-579181", req);
    expect(q).toMatchObject({ totalDiscountShippingFee: 5.39, currency: "USD", zone: "zone8" });
    await expect(client.trialPrice("JG-307699", req)).rejects.toThrow(/不通邮/);

    // 下单：嘉谷先返回“异步”，查状态时再取面单
    await client.createOrder("C-1", "JG-579181", req);
    expect(calls.find((c) => c.path === "/api/gts/ShippingLabel")!.body).toMatchObject({ OrderNbr: "C-1", ProductID: 579181, WarehouseID: 196845 });
    const d = await client.getOrder({ customNo: "C-1" });
    expect(d).toMatchObject({ status: 4, trackingNo: "GFUS123", labelUrl: "http://x/label.pdf", orderNo: "" });

    await client.cancelOrder({ customNo: "C-1" });
    expect(calls.find((c) => c.path === "/api/gts/VoidShipment")!.body).toMatchObject({ orderNbr: "C-1", warehouseID: 196845 });
    expect((await client.getOrder({ customNo: "C-1" })).status).toBe(6);
  });

  it("下单被拒绝时抛错（订单没建成），取消失败也抛错", async () => {
    fakeServer({
      "/api/gts/ShippingLabel": () => ({ IsSuccess: false, ErrorCode: "100002", Message: "订单重复" }),
      "/api/gts/VoidShipment": () => ({ IsSuccess: false, Message: "订单已出库" }),
    });
    const client = sb.getShipBestClient();
    await expect(client.createOrder("C-2", "JG-579181", req)).rejects.toBeInstanceOf(sb.ShipBestError);
    jg.jgOrders.save({ customNo: "C-3", productCode: "JG-579181", productName: "GOFO", status: 4 });
    await expect(client.cancelOrder({ customNo: "C-3" })).rejects.toThrow(/订单已出库/);
  });

  it("客户看到的名称：只显示物流商全称，不露出服务商和内部说明", async () => {
    const { defaultPublicName } = await import("@/lib/carriers");
    expect(defaultPublicName("USPS-D价-GA-917不预上网 · 嘉谷")).toBe("USPS");
    expect(defaultPublicName("GOFO-H-LAX-917 · 嘉谷")).toBe("Gofo Express");
    expect(defaultPublicName("Fedex NG末端-N · 嘉谷")).toBe("FedEx");
    expect(defaultPublicName("uniuni-LAX-917(不预上网) · 嘉谷")).toBe("UniUni Express");
    expect(defaultPublicName("UPS-D价-GROUND-923 · 嘉谷")).toBe("UPS");
    // ShipBest 的名称照旧
    expect(defaultPublicName("GOFO-（91710）")).toBe("Gofo Express");
    const { publicError } = await import("@/lib/portal");
    expect(publicError("[10061] 运费试算失败（嘉谷：算价失败）")).not.toContain("嘉谷");
  });

  it("同一个客户不能开通两个客户看起来一样的渠道", async () => {
    const { sameNameChannels, clearChannelNameCache } = await import("@/lib/channelDisplay");
    db.upsertChannels([{ code: "LP-USPS", name: "USPS-（91710）" }, { code: "JG-580914", name: "USPS-D价-GA-917不预上网 · 嘉谷" }]);
    clearChannelNameCache();
    const clash = sameNameChannels(["LP-USPS", "JG-580914", "JG-579181"]);
    expect(clash?.publicName).toBe("USPS");
    expect(clash?.names.length).toBe(2);
    expect(sameNameChannels(["LP-USPS", "JG-579181"])).toBeNull();
  });
});
