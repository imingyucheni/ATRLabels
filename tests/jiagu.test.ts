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
    expect(jg.buildJiaguBody(cfg, req, 580914).WarehouseID).toBe(196845); // USPS
    expect(jg.buildJiaguBody(cfg, req, 590297).WarehouseID).toBe(229615); // UPS
    expect(jg.buildJiaguBody(cfg, req, 580469).WarehouseID).toBe(230759); // OnTrac
    expect(jg.buildJiaguBody(cfg, req, 568995).WarehouseID).toBe(221121); // Fedex-Economy-SMP-TY · GDE-ONE-91761
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
          : { IsSuccess: true, Result: [{ ID: id, ProductName: "GOFO", TotalCharge: 5.38, RatesList: [{ Currency: "USD", ZoneCode: "8", Amount: 5.39 }] }] };
      },
      "/api/gts/ShippingLabel": () => ({ IsSuccess: false, ErrorCode: "100", Message: "供应商异步未及时返回单号" }),
      "/api/gts/GetMailNoByOrderNbr": () => ({ IsSuccess: true, Result: { TrackingNbr: "GFUS123", WaybillUrl: "http://x/label.pdf" } }),
      "/api/gts/VoidShipment": () => ({ IsSuccess: true, Result: true }),
    });
    const client = sb.getShipBestClient();
    const products = await client.getProducts();
    expect(products.map((p) => p.code)).toEqual(["JG-579181", "JG-307699"]);
    expect(products[0].name).toBe("GOFO-LAX-917(不预上网) · GDE");
    db.upsertChannels(products);

    const q = await client.trialPrice("JG-579181", req);
    expect(q).toMatchObject({ totalDiscountShippingFee: 5.39, currency: "USD", zone: "zone8" });
    await expect(client.trialPrice("JG-307699", req)).rejects.toThrow(/嘉谷返回“订单未匹配到分区”，邮编 \d+ 不在派送范围/);

    // 下单：嘉谷先返回“异步”，查状态时再取面单
    await client.createOrder("C-1", "JG-579181", req);
    expect(calls.find((c) => c.path === "/api/gts/ShippingLabel")!.body).toMatchObject({ OrderNbr: "C-1", ProductID: 579181, WarehouseID: 196845 });
    const d = await client.getOrder({ customNo: "C-1" });
    expect(d).toMatchObject({ status: 4, trackingNo: "GFUS123", labelUrl: "http://x/label.pdf", orderNo: "" });

    await client.cancelOrder({ customNo: "C-1" });
    expect(calls.find((c) => c.path === "/api/gts/VoidShipment")!.body).toMatchObject({ orderNbr: "C-1", warehouseID: 196845 });
    expect((await client.getOrder({ customNo: "C-1" })).status).toBe(6);
  });

  it("备用仓库：同一个产品换仓库算一个渠道，报价 / 下单 / 取消都用那个仓库", async () => {
    const cur = db.getSettings().jiagu;
    db.saveSettings({ jiagu: { ...cur, variants: [{ productId: "569599", warehouseId: "230206" }] } });
    try {
      expect(jg.parseJgCode("JG-569599-W230206")).toEqual({ productId: 569599, warehouseId: 230206 });
      expect(jg.parseJgCode("JG-569599")).toEqual({ productId: 569599, warehouseId: null });
      const cfg = jg.jiaguConfig()!;
      expect(jg.warehouseOfCode(cfg, "JG-569599")).toBe(221121);
      expect(jg.warehouseOfCode(cfg, "JG-569599-W230206")).toBe(230206);
      const calls = fakeServer({
        "/api/gts/ListProductSubscribe": () => ({ IsSuccess: true, Result: [{ ID: 569599, ProductName: "Fedex NG末端-N" }] }),
        "/api/gts/CalculateRates": (b) => ({ IsSuccess: true, Result: [{ ID: (b.Products as { ID: number }[])[0].ID, TotalCharge: 8.1, RatesList: [{ Currency: "USD", ZoneCode: "5", Amount: 8.1 }] }] }),
        "/api/gts/ShippingLabel": () => ({ IsSuccess: true, Result: { Identifier: "GD1", MasterTrackingNbr: "FX1", MasterLabelUrl: "http://x/l.pdf" } }),
        "/api/gts/VoidShipment": () => ({ IsSuccess: true, Result: true }),
      });
      const client = sb.getShipBestClient();
      const products = await client.getProducts();
      expect(products).toEqual([
        { code: "JG-569599", name: "Fedex NG末端-N · GDE" },
        { code: "JG-569599-W230206", name: "Fedex NG末端-N（SG-HX-CA 91762） · GDE" },
      ]);
      await client.trialPrice("JG-569599-W230206", req);
      expect(calls.find((c) => c.path === "/api/gts/CalculateRates")!.body).toMatchObject({ WarehouseID: 230206, Products: [{ ID: 569599 }] });
      await client.createOrder("C-W", "JG-569599-W230206", req);
      expect(calls.find((c) => c.path === "/api/gts/ShippingLabel")!.body).toMatchObject({ ProductID: 569599, WarehouseID: 230206 });
      await client.cancelOrder({ customNo: "C-W" });
      expect(calls.find((c) => c.path === "/api/gts/VoidShipment")!.body).toMatchObject({ warehouseID: 230206 });
    } finally {
      db.saveSettings({ jiagu: cur });
    }
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

  it("下单 5 分钟还没有面单：标异常，提示客户联系我们或换渠道；同订单号可以重新下单", async () => {
    fakeServer({
      "/api/gts/GetMailNoByOrderNbr": () => ({ IsSuccess: true, Result: {} }),
      "/api/gts/GetLabelAsync": () => ({ IsSuccess: true, Result: {} }),
    });
    const svc = await import("@/lib/service");
    const { publicError } = await import("@/lib/portal");
    const cid = db.saveCustomer(null, { name: "超时客户", contact: null, phone: null, email: null, note: null, markup: {} });
    const mk = (customNo: string, ref: string) => {
      const id = db.insertShipment({
        customNo, customerId: cid, channelCode: "JG-579181", channelName: "GOFO", sender: req.sender, recipient: req.recipient, pkg: req.pkg, skuList: req.skuList,
        quotedCost: 3, currency: "USD", zone: null, price: 4, rule: { percent: 0, fixed: 1, minProfit: 0 }, remark: null, customerRef: ref, createdBy: "admin", env: "live", addressCheck: null,
      });
      jg.jgOrders.save({ customNo, productCode: "JG-579181", productName: "GOFO", status: 2 });
      return id;
    };
    const late = mk("T-LATE", "R-LATE");
    db.db().prepare("UPDATE shipments SET created_at = datetime('now', '-6 minutes') WHERE id = ?").run(late);
    const fresh = mk("T-FRESH", "R-FRESH");

    const s1 = await svc.refreshShipment(late);
    expect(s1.status).toBe("exception");
    expect(s1.errorMsg).toContain("5 分钟内未出面单");
    expect(publicError(s1.errorMsg)).toBe("该渠道出单超时，还没有生成面单。请联系客服，或换其他渠道重新下单");
    expect(db.activeShipmentByRef(cid, "R-LATE")).toBeUndefined(); // 可以换渠道重新下单
    expect((await svc.refreshShipment(late)).status).toBe("exception"); // 再刷新也保持异常
    // 服务商反馈：同样的返回只记一条，带次数；系统判断只记一次
    const { listProviderEvents } = await import("@/lib/providerLog");
    const ev = listProviderEvents("T-LATE");
    expect(ev.find((e) => e.action === "查询面单（GetMailNoByOrderNbr）")).toMatchObject({ provider: "嘉谷", times: 2, message: "成功 · 没有运单号 · 没有面单" });
    expect(ev.filter((e) => e.action === "系统判断").length).toBe(1);

    expect((await svc.refreshShipment(fresh)).status).toBe("pending"); // 还没到 5 分钟
    expect(db.activeShipmentByRef(cid, "R-FRESH")).toBeDefined();
  });

  it("超时自动作废：能作废的直接取消退款；作废不了的，客户换单重下后面单迟到了自动作废，不会两张都扣费", async () => {
    let voidOk = true;
    let labelReady = false;
    fakeServer({
      "/api/gts/GetMailNoByOrderNbr": () => ({ IsSuccess: true, Result: labelReady ? { TrackingNbr: "9400LATE", WaybillUrl: "mock://late.pdf" } : {} }),
      "/api/gts/GetLabelAsync": () => ({ IsSuccess: true, Result: {} }),
      "/api/gts/VoidShipment": () => (voidOk ? { IsSuccess: true, Result: true } : { IsSuccess: false, ErrorCode: "11203", Message: "该订单不支持取消" }),
    });
    const svc = await import("@/lib/service");
    const { publicError } = await import("@/lib/portal");
    const cid = db.saveCustomer(null, { name: "作废客户", contact: null, phone: null, email: null, note: null, markup: {} });
    const mk = (customNo: string, ref: string, minsAgo = 6) => {
      const id = db.insertShipment({
        customNo, customerId: cid, channelCode: "JG-579181", channelName: "GOFO", sender: req.sender, recipient: req.recipient, pkg: req.pkg, skuList: req.skuList,
        quotedCost: 3, currency: "USD", zone: null, price: 4, rule: { percent: 0, fixed: 1, minProfit: 0 }, remark: null, customerRef: ref, createdBy: "admin", env: "live", addressCheck: null,
      });
      jg.jgOrders.save({ customNo, productCode: "JG-579181", productName: "GOFO", status: 2 });
      db.db().prepare(`UPDATE shipments SET created_at = datetime('now', '-${minsAgo} minutes') WHERE id = ?`).run(id);
      return id;
    };
    // 1. 超时 → 自动向嘉谷作废成功 → 取消、全额退款、不收取消费
    const a = mk("V-A", "R-A");
    const sa = await svc.refreshShipment(a);
    expect(sa).toMatchObject({ status: "cancelled", cancelFee: 0, refundAmount: 4 });
    expect(publicError(sa.errorMsg)).toContain("已自动取消并全额退回");

    // 2. 超时 → 作废失败 → 保持异常；客户用同一订单号换渠道重下（这里直接插一张新单并关联）
    voidOk = false;
    const b = mk("V-B", "R-B");
    expect((await svc.refreshShipment(b)).status).toBe("exception");
    const nb = mk("V-B2", "R-B", 0);
    db.updateShipment(b, { replacedBy: nb });
    // 面单后来又出来了：自动作废迟到的面单
    labelReady = true;
    voidOk = true;
    const sb2 = await svc.refreshShipment(b);
    expect(sb2).toMatchObject({ status: "cancelled", cancelFee: 0, refundAmount: 4 });
    expect(sb2.errorMsg).toContain("延迟生成");
    // 作废也失败：转“取消处理中”，提示管理员找服务商作废
    labelReady = false;
    voidOk = false;
    const c = mk("V-C", "R-C");
    await svc.refreshShipment(c);
    db.updateShipment(c, { replacedBy: nb });
    labelReady = true;
    const sc = await svc.refreshShipment(c);
    expect(sc.status).toBe("cancel_requested");
    expect(sc.errorMsg).toContain("确认已取消");
  });

  it("客户看到的名称：只显示物流商全称，不露出服务商和内部说明", async () => {
    const { defaultPublicName } = await import("@/lib/carriers");
    expect(defaultPublicName("USPS-D价-GA-917不预上网 · GDE")).toBe("USPS");
    expect(defaultPublicName("GOFO-H-LAX-917 · GDE")).toBe("Gofo Express");
    // FedEx Ground 和 Economy（SmartPost）是两种服务，名称分开，同一个客户可以一起开通
    expect(defaultPublicName("Fedex NG末端-N · GDE")).toBe("FedEx Ground");
    expect(defaultPublicName("Fedex-Economy-SMP-TY · GDE")).toBe("FedEx Economy (SmartPost)");
    expect(defaultPublicName("uniuni-LAX-917(不预上网) · GDE")).toBe("UniUni Express");
    expect(defaultPublicName("UPS-D价-GROUND-923 · GDE")).toBe("UPS");
    expect(defaultPublicName("Ontrac-SG-B-XT · GDE")).toBe("OnTrac");
    // ShipBest 的名称照旧（带不带“· SB”标记都一样）
    expect(defaultPublicName("GOFO-（91710）")).toBe("Gofo Express");
    expect(defaultPublicName("GOFO-（91710） · SB")).toBe("Gofo Express");
    expect(defaultPublicName("YWE Air-91710 · SB")).toBe("Yanwen Express Air");
    expect(defaultPublicName("SPX-LAX · SB")).toBe("SPX Express");
    expect(defaultPublicName("USPS-（91710） · SB")).toBe("USPS");
    const { publicError } = await import("@/lib/portal");
    expect(publicError("[10061] 运费试算失败（嘉谷：算价失败）")).not.toContain("嘉谷");
  });

  it("同一个客户不能开通两个客户看起来一样的渠道", async () => {
    const { sameNameChannels, clearChannelNameCache } = await import("@/lib/channelDisplay");
    db.upsertChannels([{ code: "LP-USPS", name: "USPS-（91710） · SB" }, { code: "JG-580914", name: "USPS-D价-GA-917不预上网 · GDE" }]);
    clearChannelNameCache();
    const clash = sameNameChannels(["LP-USPS", "JG-580914", "JG-579181"]);
    expect(clash?.publicName).toBe("USPS");
    expect(clash?.names.length).toBe(2);
    expect(sameNameChannels(["LP-USPS", "JG-579181"])).toBeNull();
    db.upsertChannels([{ code: "JG-569599", name: "Fedex NG末端-N · GDE" }, { code: "JG-568995", name: "Fedex-Economy-SMP-TY · GDE" }]);
    clearChannelNameCache();
    expect(sameNameChannels(["JG-569599", "JG-568995"])).toBeNull();

    // ShipBest 导单表里写的是原来的渠道名（没有“· SB”），照样能对上渠道；订单里记的原名也能查到客户显示名
    const { matchChannel } = await import("@/lib/batch");
    expect(matchChannel("USPS-（91710）")).toBe("LP-USPS");
    const { displayChannel } = await import("@/lib/channelDisplay");
    db.setChannelDisplay("LP-USPS", "USPS Ground Advantage", "usps");
    clearChannelNameCache();
    expect(displayChannel("USPS-（91710）").name).toBe("USPS Ground Advantage");
  });
});
