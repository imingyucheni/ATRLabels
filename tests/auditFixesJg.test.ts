import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-auditfix-jg-"));
process.env.ATR_SINGLE_DB = "1";
delete process.env.SHIPBEST_MOCK;

// 面单下载慢一点（多箱合并 PDF 时本来就要这么久），用来检查刷新期间的取消不会被覆盖
let slowDownload = 0;
vi.mock("@/lib/labels", async (orig) => {
  const m = await orig<typeof import("@/lib/labels")>();
  return {
    ...m,
    downloadLabel: async () => {
      if (slowDownload) await new Promise((r) => setTimeout(r, slowDownload));
      return { path: "none.pdf", mime: "application/pdf" };
    },
    readLabel: () => Buffer.from("%PDF-1.4"),
  };
});

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", phone: "9095550100", country: "US", city: "Chino", address1: "1 Main St", zipCode: "91710", province: "CA" },
  recipient: { nameFirst: "Jane", nameLast: "Roe", country: "US", city: "Austin", address1: "2 Elm St", zipCode: "78701", province: "TX" },
  pkg: { length: 10, width: 8, height: 4, weight: 1.5, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "SKU-1", productNameCn: "T恤", productNameEn: "T-Shirt", quantity: 2, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "6109100000", productNature: "2,4", length: 1, width: 1, height: 1, weight: 1, unit: 3 }],
};

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

describe("嘉谷相关的修复", () => {
  let db: typeof import("@/lib/db");
  let svc: typeof import("@/lib/service");
  let ledger: typeof import("@/lib/ledger");
  let promo: typeof import("@/lib/promotions");
  const cust = (name: string) => {
    const id = db.saveCustomer(null, { name, contact: null, phone: null, email: null, note: null, markup: { percent: 0, fixed: 1, minProfit: 0 } });
    ledger.addLedger({ customerId: id, type: "topup", amount: 100 });
    return id;
  };

  beforeAll(async () => {
    db = await import("@/lib/db");
    svc = await import("@/lib/service");
    ledger = await import("@/lib/ledger");
    promo = await import("@/lib/promotions");
    db.saveSettings({
      shipbest: { mode: "live", apiId: "", token: "" },
      jiagu: { enabled: true, clientId: "id", secret: "s", ownershipId: "1001", customerId: "2002", warehouseId: "", variants: [{ productId: "569599", warehouseId: "230206", name: "Fedex NG 2", autoFailover: true }] },
    });
    db.upsertChannels([{ code: "JG-569599", name: "Fedex NG末端-N · GDE" }, { code: "JG-569599-W230206", name: "Fedex NG 2 · GDE" }, { code: "JG-579181", name: "GOFO-LAX-917 · GDE" }]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    slowDownload = 0;
  });

  it("自动备用：利润、对账按备用渠道算（主渠道的限时活动返利不跟过去）", async () => {
    const c = cust("备用客户");
    db.setCustomerChannels(c, ["JG-569599"]);
    const today = new Date().toLocaleDateString("en-CA");
    const p = promo.savePromotion(null, { channelCode: "JG-569599", label: "限时折扣", rebatePercent: 30, customerPercent: -10, startsOn: today, endsOn: today, enabled: true, note: null });
    let backupCost = 0;
    fakeServer({
      "/api/gts/CalculateRates": (b) => {
        const amt = b.WarehouseID === 230206 ? backupCost : 8;
        return { IsSuccess: true, Result: [{ ID: 569599, TotalCharge: amt, RatesList: [{ Currency: "USD", ZoneCode: "5", Amount: amt }] }] };
      },
      "/api/gts/ShippingLabel": (b) => (b.WarehouseID === 221121 ? { IsSuccess: false, ErrorCode: "500", Message: "仓库暂停收货" } : { IsSuccess: true, Result: { Identifier: "GD-B", MasterTrackingNbr: "FXB", MasterLabelUrl: "http://x/b.pdf" } }),
    });
    svc.clearQuoteCache();
    const q = await svc.quoteChannel(c, "JG-569599", req);
    expect(q.rule?.source).toBe("promo");
    backupCost = Math.round(q.price! * 0.9 * 100) / 100;
    const id = await svc.createLabel({ customerId: c, channelCode: "JG-569599", req, expectedPrice: q.price!, customerRef: "FO-R", waitForLabel: false });
    const s = db.getShipment(id)!;
    expect(s.channelCode).toBe("JG-569599-W230206");
    expect(s.rule.promoId).toBeUndefined();
    expect(s.rule.rebate).toBeUndefined();
    expect(db.shipmentProfit(s)).toBeCloseTo(s.price - backupCost, 2);
    promo.deletePromotion(p);
  });

  it("刷新正在下载面单时客户取消了：刷新结束不能把已取消、已退款的单改回“已出单”", async () => {
    const c = cust("刷新客户");
    db.setCustomerChannels(c, ["JG-579181"]);
    fakeServer({
      "/api/gts/CalculateRates": () => ({ IsSuccess: true, Result: [{ ID: 579181, TotalCharge: 5, RatesList: [{ Currency: "USD", ZoneCode: "5", Amount: 5 }] }] }),
      "/api/gts/ShippingLabel": () => ({ IsSuccess: false, ErrorCode: "100", Message: "供应商异步未及时返回单号" }),
      "/api/gts/GetMailNoByOrderNbr": () => ({ IsSuccess: true, Result: { TrackingNbr: "GF1", WaybillUrl: "http://x/l.pdf" } }),
      "/api/gts/VoidShipment": () => ({ IsSuccess: true, Result: true }),
    });
    svc.clearQuoteCache();
    const q = await svc.quoteChannel(c, "JG-579181", req);
    const id = await svc.createLabel({ customerId: c, channelCode: "JG-579181", req, expectedPrice: q.price!, customerRef: "RACE-R", waitForLabel: false });
    slowDownload = 200;
    const refresh = svc.refreshShipment(id);
    await new Promise((r) => setTimeout(r, 50));
    const r = await svc.requestCancel(id);
    expect(r.done).toBe(true);
    await refresh;
    expect(db.getShipment(id)!.status).toBe("cancelled");
    expect(ledger.balanceOf(c)).toBeCloseTo(100, 2);
  });

  it("超时转异常、自动作废没成功的单，面单后来生成了：照常可用，但提醒可能重复下单", async () => {
    const c = cust("迟到客户");
    db.setCustomerChannels(c, ["JG-579181"]);
    let labelReady = false;
    fakeServer({
      "/api/gts/CalculateRates": () => ({ IsSuccess: true, Result: [{ ID: 579181, TotalCharge: 5, RatesList: [{ Currency: "USD", ZoneCode: "5", Amount: 5 }] }] }),
      "/api/gts/ShippingLabel": () => ({ IsSuccess: false, ErrorCode: "100", Message: "供应商异步未及时返回单号" }),
      "/api/gts/GetMailNoByOrderNbr": () => (labelReady ? { IsSuccess: true, Result: { TrackingNbr: "GF2", WaybillUrl: "http://x/l2.pdf" } } : { IsSuccess: false, Message: "未找到" }),
      "/api/gts/GetLabelAsync": () => ({ IsSuccess: false, Message: "未找到" }),
      "/api/gts/VoidShipment": () => ({ IsSuccess: false, ErrorCode: "400109", Message: "订单已出库" }),
    });
    svc.clearQuoteCache();
    const q = await svc.quoteChannel(c, "JG-579181", req);
    const id = await svc.createLabel({ customerId: c, channelCode: "JG-579181", req, expectedPrice: q.price!, customerRef: "LATE-1", waitForLabel: false });
    db.db().prepare("UPDATE shipments SET created_at = datetime('now', '-10 minutes') WHERE id = ?").run(id);
    await svc.refreshShipment(id);
    expect(db.getShipment(id)!.status).toBe("exception");
    labelReady = true;
    await svc.refreshShipment(id);
    const s = db.getShipment(id)!;
    expect(s.status).toBe("labeled");
    expect(s.errorMsg).toMatch(/超时后面单才生成/);
  });
});
