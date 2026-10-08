import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-jg-repush-"));
process.env.ATR_SINGLE_DB = "1";
delete process.env.SHIPBEST_MOCK;

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", phone: "9095550100", country: "US", city: "Chino", address1: "1 Main St", zipCode: "91710", province: "CA" },
  recipient: { nameFirst: "Jane", nameLast: "Roe", country: "US", city: "Austin", address1: "2 Elm St", zipCode: "78701", province: "TX" },
  pkg: { length: 10, width: 8, height: 4, weight: 1.5, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "SKU-1", productNameCn: "T恤", productNameEn: "T-Shirt", quantity: 1, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "6109100000", productNature: "2,4", length: 1, width: 1, height: 1, weight: 1, unit: 3 }],
};

type Handler = (body: Record<string, unknown>) => unknown;

/** 假的嘉谷服务器：记录请求，按路径返回（handler 可以是一串返回，按顺序用，用完重复最后一个） */
function fakeServer(handlers: Record<string, Handler | unknown[]>) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const seq: Record<string, number> = {};
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const u = new URL(url);
    if (u.pathname === "/connect/token") return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    const body = JSON.parse(String(init.body ?? "{}"));
    calls.push({ path: u.pathname, body });
    const h = handlers[u.pathname];
    let out: unknown = { IsSuccess: false, Message: "no handler" };
    if (Array.isArray(h)) {
      const i = Math.min(seq[u.pathname] ?? 0, h.length - 1);
      seq[u.pathname] = i + 1;
      out = h[i];
    } else if (h) out = h(body);
    return new Response(JSON.stringify(out));
  });
  return calls;
}

const empty = { IsSuccess: true, Result: {} };

describe("嘉谷：ErrorCode=100 重新推送、仓库记在订单上、多箱面单不被覆盖", () => {
  let db: typeof import("@/lib/db");
  let jg: typeof import("@/lib/shipbest/jiagu");
  let sb: typeof import("@/lib/shipbest/client");
  let log: typeof import("@/lib/providerLog");
  const t0 = Date.parse("2026-10-08T10:00:00Z");
  /** 把时间拨到下单后 sec 秒（只换 Date，不影响 fetch / Promise） */
  const at = (sec: number) => vi.setSystemTime(t0 + sec * 1000);

  beforeAll(async () => {
    db = await import("@/lib/db");
    jg = await import("@/lib/shipbest/jiagu");
    sb = await import("@/lib/shipbest/client");
    log = await import("@/lib/providerLog");
    db.saveSettings({
      shipbest: { mode: "live", apiId: "", token: "" },
      jiagu: { enabled: true, clientId: "id", secret: "s", ownershipId: "1001", customerId: "2002", warehouseId: "", warehouses: {} },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("下单返回 100：记下请求体；查不到面单时按原请求体重新推送（隔 45 秒以上），100 / 100100 继续等，成功后记下多箱面单", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(0);
    const multi = { IsSuccess: true, Result: { Identifier: "GD9", MasterTrackingNbr: "1Z999", labels: [{ labelUri: "http://x/p1.pdf" }, { labelUri: "http://x/p2.pdf" }] } };
    const calls = fakeServer({
      "/api/gts/ShippingLabel": [
        { IsSuccess: false, ErrorCode: "100", Message: "供应商异步未及时返回单号" },
        { IsSuccess: false, ErrorCode: "100", Message: "供应商异步未及时返回单号" },
        { IsSuccess: false, ErrorCode: "100100", Message: "订单已经存在" },
        multi,
      ],
      "/api/gts/GetMailNoByOrderNbr": () => ({ IsSuccess: false, ErrorCode: "900901", Message: "数据没有找到" }),
      "/api/gts/GetLabelAsync": () => empty,
    });
    const client = sb.getShipBestClient();
    await client.createOrder("RP-1", "JG-579181", req); // 100 不抛错：不删单、不退款
    const pushes = () => calls.filter((c) => c.path === "/api/gts/ShippingLabel");
    const first = pushes()[0].body;
    const row = jg.jgOrders.get("RP-1")!;
    expect(row).toMatchObject({ status: 2, warehouseId: 196845, repushes: 0 });
    expect(row.pushBody).toEqual(first);
    expect(log.listProviderEvents("RP-1").find((e) => e.action === "提交订单")?.message).toBe("已接单，面单稍后生成 · 供应商异步未及时返回单号 · 仓库 GALAX（196845）");

    // 刚下单：只查询，不重新推送
    at(10);
    expect((await client.getOrder({ customNo: "RP-1" })).status).toBe(2);
    expect(pushes().length).toBe(1);

    // 45 秒后还没面单：原样重新推送（同一个订单号、同样的内容）
    at(50);
    expect((await client.getOrder({ customNo: "RP-1" })).status).toBe(2);
    expect(pushes().length).toBe(2);
    expect(pushes()[1].body).toEqual(first);
    // 间隔不到 45 秒：不再推
    at(60);
    await client.getOrder({ customNo: "RP-1" });
    expect(pushes().length).toBe(2);

    // 返回“订单已经存在”：继续等，不报错
    at(100);
    expect((await client.getOrder({ customNo: "RP-1" })).status).toBe(2);
    expect(pushes().length).toBe(3);

    // 推送成功：拿到运单号和每箱的面单
    at(150);
    const d = await client.getOrder({ customNo: "RP-1" });
    expect(pushes().length).toBe(4);
    expect(d).toMatchObject({ status: 4, trackingNo: "1Z999", labelUrl: `multi:${JSON.stringify(["http://x/p1.pdf", "http://x/p2.pdf"])}` });
    expect(jg.jgOrders.get("RP-1")).toMatchObject({ identifier: "GD9", repushes: 3 });
    const ev = log.listProviderEvents("RP-1").filter((e) => e.action === "重新推送（ShippingLabel）").map((e) => e.message);
    expect(ev).toEqual([
      "第 1 次 · 供应商仍未返回单号，继续等 · 供应商异步未及时返回单号 · 没有运单号 · 没有面单",
      "第 2 次 · 订单已在嘉谷，继续等面单 · 订单已经存在 · 没有运单号 · 没有面单",
      "第 3 次 · 成功 · 嘉谷单号 GD9 · 运单号 1Z999 · 有面单",
    ]);
    // 已出面单：之后刷新不再查、不再推
    at(300);
    const before = calls.length;
    await client.getOrder({ customNo: "RP-1" });
    expect(calls.length).toBe(before);
  });

  it("重新推送有上限：最多 5 次、下单 4 分钟后不再推；其他错误只记录、继续等；申请过取消的单不再推", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(0);
    const seen = new Set<unknown>();
    const calls = fakeServer({
      // 每个订单第一次提交返回 100，之后重新推送都返回 700401（推送异常）
      "/api/gts/ShippingLabel": (b) => {
        if (seen.has(b.OrderNbr)) return { IsSuccess: false, ErrorCode: "700401", Message: "API推送订单异常" };
        seen.add(b.OrderNbr);
        return { IsSuccess: false, ErrorCode: "100", Message: "供应商异步未及时返回单号" };
      },
      "/api/gts/GetMailNoByOrderNbr": () => empty,
      "/api/gts/GetLabelAsync": () => empty,
      "/api/gts/VoidShipment": () => ({ IsSuccess: false, ErrorCode: "400109", Message: "订单已出库" }),
    });
    const client = sb.getShipBestClient();
    await client.createOrder("RP-2", "JG-579181", req);
    const pushes = () => calls.filter((c) => c.path === "/api/gts/ShippingLabel" && c.body.OrderNbr === "RP-2").length;
    for (let s = 46; s <= 239; s += 46) {
      at(s);
      // 推送失败（700401）不抛错，订单保持待出单
      expect((await client.getOrder({ customNo: "RP-2" })).status).toBe(2);
    }
    expect(pushes()).toBe(1 + 5);
    at(239);
    await client.getOrder({ customNo: "RP-2" });
    expect(pushes()).toBe(6); // 5 次用完
    expect(log.listProviderEvents("RP-2").filter((e) => e.action === "重新推送（ShippingLabel）").at(-1)?.message).toBe("第 5 次 · 失败，继续等面单 · API推送订单异常 · 没有运单号 · 没有面单");

    // 4 分钟以后不再推（5 分钟没面单会转异常并自动作废，不能再推出一张新单）
    await client.createOrder("RP-3", "JG-579181", req);
    const pushes3 = () => calls.filter((c) => c.path === "/api/gts/ShippingLabel" && c.body.OrderNbr === "RP-3").length;
    at(239 + 241);
    await client.getOrder({ customNo: "RP-3" });
    expect(pushes3()).toBe(1);

    // 申请过取消（作废失败）：不再推
    at(1000);
    await client.createOrder("RP-4", "JG-579181", req);
    await expect(client.cancelOrder({ customNo: "RP-4" })).rejects.toThrow(/订单已出库/);
    at(1050);
    await client.getOrder({ customNo: "RP-4" });
    expect(calls.filter((c) => c.path === "/api/gts/ShippingLabel" && c.body.OrderNbr === "RP-4").length).toBe(1);

    // 以前的记录没有请求体：照旧只查询
    jg.jgOrders.save({ customNo: "RP-OLD", productCode: "JG-579181", productName: "GOFO", status: 2 });
    await client.getOrder({ customNo: "RP-OLD" });
    expect(calls.some((c) => c.path === "/api/gts/ShippingLabel" && c.body.OrderNbr === "RP-OLD")).toBe(false);
  });

  it("下单返回 700402（获取面单异常）：按已接单处理，不退款、不切备用；之后能取到面单", async () => {
    const cur = db.getSettings().jiagu;
    db.saveSettings({ jiagu: { ...cur, variants: [{ productId: "569599", warehouseId: "230206", name: "Fedex NG 2", autoFailover: true }] } });
    const svc = await import("@/lib/service");
    const ledger = await import("@/lib/ledger");
    try {
      db.upsertChannels([{ code: "JG-569599", name: "Fedex NG末端-N · GDE" }, { code: "JG-569599-W230206", name: "Fedex NG 2 · GDE" }]);
      const cid = db.saveCustomer(null, { name: "700402 客户", contact: null, phone: null, email: null, note: null, markup: { percent: 0, fixed: 1, minProfit: 0 } });
      db.setCustomerChannels(cid, ["JG-569599"]);
      ledger.addLedger({ customerId: cid, type: "topup", amount: 100 });
      let ready = false;
      const calls = fakeServer({
        "/api/gts/CalculateRates": (b) => ({ IsSuccess: true, Result: [{ ID: 569599, TotalCharge: b.WarehouseID === 230206 ? 1 : 8, RatesList: [{ Currency: "USD", ZoneCode: "5", Amount: b.WarehouseID === 230206 ? 1 : 8 }] }] }),
        "/api/gts/ShippingLabel": () => ({ IsSuccess: false, ErrorCode: "700402", Message: "API获取面单异常" }),
        "/api/gts/GetMailNoByOrderNbr": () => (ready ? { IsSuccess: true, Result: { TrackingNbr: "FX700", WaybillUrl: "mock://late.pdf" } } : empty),
        "/api/gts/GetLabelAsync": () => empty,
      });
      svc.clearQuoteCache();
      const q = (await svc.quoteAll(cid, req)).find((x) => x.channelCode === "JG-569599")!;
      const id = await svc.createLabel({ customerId: cid, channelCode: "JG-569599", req, expectedPrice: q.price!, customerRef: "E-700402", waitForLabel: false });
      const s = db.getShipment(id)!;
      // 订单保留、照常扣费，没有改用备用（备用便宜也不切）
      expect(s).toMatchObject({ status: "pending", channelCode: "JG-569599" });
      expect(ledger.balanceOf(cid)).toBeCloseTo(100 - q.price!, 2);
      expect(calls.filter((c) => c.path === "/api/gts/ShippingLabel").map((c) => c.body.WarehouseID)).toEqual([221121]);
      expect(log.listProviderEvents(s.customNo).find((e) => e.action === "提交订单")?.message).toMatch(/^获取面单异常，订单可能已建好，稍后再查面单 · API获取面单异常 · 仓库 GDE-ONE-91761（221121）$/);
      ready = true;
      expect((await svc.refreshShipment(id)).status).toBe("labeled");
    } finally {
      db.saveSettings({ jiagu: cur });
    }
  });

  it("取消按下单时的仓库作废：后台之后改了仓库设置也不会作废到别的仓库；以前没记仓库的单按当前设置", async () => {
    const calls = fakeServer({
      "/api/gts/ShippingLabel": () => ({ IsSuccess: true, Result: { Identifier: "GDW", MasterTrackingNbr: "TRW", MasterLabelUrl: "http://x/w.pdf" } }),
      "/api/gts/VoidShipment": () => ({ IsSuccess: true, Result: true }),
    });
    await sb.getShipBestClient().createOrder("WH-1", "JG-579181", req);
    expect(jg.jgOrders.get("WH-1")?.warehouseId).toBe(196845);
    const cur = db.getSettings().jiagu;
    try {
      // 下单后把这个渠道改到别的仓库
      db.saveSettings({ jiagu: { ...cur, warehouses: { "579181": "230759" } } });
      const cfg = jg.jiaguConfig()!;
      expect(jg.warehouseOfCode(cfg, "JG-579181")).toBe(230759);
      expect(jg.orderWarehouse(cfg, "WH-1", "JG-579181")).toBe(196845);
      const client = sb.getShipBestClient();
      await client.cancelOrder({ customNo: "WH-1" });
      expect(calls.filter((c) => c.path === "/api/gts/VoidShipment").at(-1)!.body).toMatchObject({ orderNbr: "WH-1", warehouseID: 196845 });
      expect(jg.jgOrders.get("WH-1")?.status).toBe(6);
      // 以前的单没记仓库：按当前设置
      jg.jgOrders.save({ customNo: "WH-OLD", productCode: "JG-579181", productName: "GOFO", status: 4 });
      await client.cancelOrder({ customNo: "WH-OLD" });
      expect(calls.filter((c) => c.path === "/api/gts/VoidShipment").at(-1)!.body).toMatchObject({ orderNbr: "WH-OLD", warehouseID: 230759 });
    } finally {
      db.saveSettings({ jiagu: cur });
    }

    // 主渠道被拒、同一个单号改用备用渠道再提交：记录里的仓库跟着改成备用的
    fakeServer({
      "/api/gts/ShippingLabel": (b) => (b.WarehouseID === 221121 ? { IsSuccess: false, ErrorCode: "500", Message: "仓库暂停收货" } : { IsSuccess: true, Result: { MasterTrackingNbr: "TRB", MasterLabelUrl: "http://x/b.pdf" } }),
    });
    db.saveSettings({ jiagu: { ...cur, variants: [{ productId: "569599", warehouseId: "230206" }] } });
    try {
      const client = sb.getShipBestClient();
      await expect(client.createOrder("WH-2", "JG-569599", req)).rejects.toBeInstanceOf(sb.ShipBestError);
      expect(jg.jgOrders.get("WH-2")?.warehouseId).toBe(221121);
      await client.createOrder("WH-2", "JG-569599-W230206", req);
      expect(jg.jgOrders.get("WH-2")).toMatchObject({ productCode: "JG-569599-W230206", warehouseId: 230206, status: 4 });
    } finally {
      db.saveSettings({ jiagu: cur });
    }
  });

  it("下单时拿到了多箱面单但没有运单号：之后查到运单号只补运单号，每箱的面单不被单张 WaybillUrl 覆盖", async () => {
    const uris = ["http://x/m1.pdf", "http://x/m2.pdf", "http://x/m3.pdf"];
    fakeServer({
      "/api/gts/ShippingLabel": () => ({ IsSuccess: true, Result: { Identifier: "GDM", labels: uris.map((labelUri) => ({ labelUri })) } }),
      "/api/gts/GetMailNoByOrderNbr": () => ({ IsSuccess: true, Result: { TrackingNbr: "1ZMULTI", WaybillUrl: "http://x/master.pdf" } }),
    });
    const client = sb.getShipBestClient();
    await client.createOrder("MB-1", "JG-582918", req);
    expect(jg.jgOrders.get("MB-1")).toMatchObject({ status: 2, labelUrl: `multi:${JSON.stringify(uris)}` });
    const d = await client.getOrder({ customNo: "MB-1" });
    expect(d).toMatchObject({ status: 4, trackingNo: "1ZMULTI", labelUrl: `multi:${JSON.stringify(uris)}` });

    expect(jg.mergeLabel("multi:[\"a\",\"b\"]", "http://x/one.pdf")).toBe("multi:[\"a\",\"b\"]");
    expect(jg.mergeLabel("http://x/one.pdf", "multi:[\"a\",\"b\"]")).toBe("multi:[\"a\",\"b\"]");
    expect(jg.mergeLabel(null, "http://x/one.pdf")).toBe("http://x/one.pdf");
    expect(jg.mergeLabel("http://x/old.pdf", "http://x/new.pdf")).toBe("http://x/old.pdf");
    expect(jg.mergeLabel(undefined, undefined)).toBeNull();
  });
});
