import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-dhl-live-"));
process.env.ATR_SINGLE_DB = "1";
delete process.env.SHIPBEST_MOCK;
delete process.env.APP_ENV;

const req: ShipmentRequest = {
  sender: { nameFirst: "ATR", nameLast: "Warehouse", country: "US", province: "CA", city: "Chino", address1: "13950 Central Ave", zipCode: "91710", phone: "9095550100" },
  recipient: { nameFirst: "Oliver", nameLast: "Smith", country: "GB", city: "London", address1: "221B Baker Street", zipCode: "NW1 6XE", phone: "+44 20 7946 0000" },
  pkg: { length: 12, width: 10, height: 6, weight: 3.3, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "SKU-1", productNameCn: "T恤", productNameEn: "Cotton T-shirt", quantity: 2, declaredUnitPrice: 12.5, declaredCurrency: "USD", hsCode: "6109.10.0010", productNature: "2,4", material: "100% cotton", length: 12, width: 10, height: 6, weight: 0, unit: 3 }],
};

const DHL_KEYS = { apiKey: "k", apiSecret: "s", accountNumber: "123456789" };

/** 假的 DHL / ShipBest 服务器：记录请求；出单接口按 shipments() 的返回（抛错 = 超时） */
function fakeServers(shipments: () => Response | Promise<Response>) {
  const calls: { host: string; path: string; method: string }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push({ host: u.host, path: u.pathname, method: String(init.method ?? "GET") });
    if (u.host === "express.api.dhl.com") {
      if (u.pathname.endsWith("/rates")) {
        return new Response(JSON.stringify({ products: [{ productCode: "P", productName: "EXPRESS WORLDWIDE", totalPrice: [{ currencyType: "BILLC", priceCurrency: "USD", price: 61.2 }], deliveryCapabilities: { totalTransitDays: 3 } }] }));
      }
      if (u.pathname.endsWith("/shipments")) return shipments();
      return new Response(JSON.stringify({ title: "Not Found", status: 404 }), { status: 404 });
    }
    // ShipBest：DHL 的单不应该被分到这里
    return new Response(JSON.stringify({ code: 11202, message: "The order was not found in the system!" }));
  });
  return calls;
}

describe("DHL：正式模式下的测试环境、提交结果未知", () => {
  let db: typeof import("@/lib/db");
  let sb: typeof import("@/lib/shipbest/client");
  let dhl: typeof import("@/lib/shipbest/dhl");
  let svc: typeof import("@/lib/service");
  let ledger: typeof import("@/lib/ledger");
  let cid: number;

  beforeAll(async () => {
    db = await import("@/lib/db");
    sb = await import("@/lib/shipbest/client");
    dhl = await import("@/lib/shipbest/dhl");
    svc = await import("@/lib/service");
    ledger = await import("@/lib/ledger");
    db.saveSettings({ shipbest: { mode: "live", apiId: "id", token: "tok" }, dhl: { ...dhl.DEFAULT_DHL, ...DHL_KEYS, enabled: true, mode: "test" }, sender: req.sender });
    db.upsertChannels((await new dhl.DhlClient({ ...DHL_KEYS, baseUrl: "x", labelTemplate: "ECOM26_A6_002", paperless: true, originCountry: "CN" }).getProducts()));
    cid = db.saveCustomer(null, { name: "国际客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(cid, ["DHL-P", "DHL-Y", "DHL-E"]);
    ledger.addLedger({ customerId: cid, type: "topup", amount: 500, createdBy: "admin" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    svc.clearQuoteCache();
  });

  it("正式模式下 DHL 还是测试环境：不报价、不出单（后台看到原因，客户只看到渠道暂时无法报价）；测试账号、DHL 正式环境、沙盒模式不受影响", async () => {
    const calls = fakeServers(() => new Response(JSON.stringify({ detail: "不应该出单" }), { status: 500 }));
    expect(sb.dhlTestOnLive()).toBe(true);
    const c = sb.getShipBestClient();
    const err = await c.trialPrice("DHL-P", req).catch((e) => e);
    expect(err).toBeInstanceOf(sb.ShipBestError);
    expect(err.message).toContain(sb.DHL_TEST_ON_LIVE_MSG);
    await expect(c.createOrder("DT-1", "DHL-P", req)).rejects.toBeInstanceOf(sb.ShipBestError);
    expect(calls.filter((x) => x.host === "express.api.dhl.com").length).toBe(0); // 根本没去连 DHL
    const { publicError, publicQuoteError, toPublicQuote } = await import("@/lib/portal");
    expect(publicQuoteError(err.message)).toBe("该渠道暂时无法报价");
    expect(publicError(err.message)).toBe("系统繁忙，请稍后再试或联系客服");
    const { translateMessage } = await import("@/lib/i18n");
    expect(translateMessage("en", err.message)).toMatch(/^\[10023\] Service is disabled \(DHL is still set to its test environment/);

    // 报价页：DHL 渠道全部报不出价，下单也下不了（不扣钱）
    const quotes = await svc.quoteAll(cid, req);
    expect(quotes.length).toBe(3);
    expect(quotes.every((q) => !q.ok && /测试环境/.test(q.error ?? ""))).toBe(true);
    expect(toPublicQuote(quotes[0]).error).toBe("该渠道暂时无法报价");
    await expect(svc.createLabel({ customerId: cid, channelCode: "DHL-P", req, expectedPrice: 70 })).rejects.toThrow(/测试环境/);
    expect(ledger.balanceOf(cid)).toBe(500);

    // 内部测试账号：下单是模拟的，DHL 测试环境照样可以报价试用
    const q = await sb.getTestAccountClient().trialPrice("DHL-P", req);
    expect(q?.totalDiscountShippingFee).toBe(61.2);
    expect(calls.some((x) => x.path === "/mydhlapi/test/rates")).toBe(true);

    // 沙盒模式：下单是模拟的，不拦
    db.saveSettings({ shipbest: { mode: "sandbox", apiId: "id", token: "tok" } });
    try {
      expect(sb.dhlTestOnLive()).toBe(false);
      expect((await sb.getShipBestClient().trialPrice("DHL-P", req))?.totalDiscountShippingFee).toBe(61.2);
    } finally {
      db.saveSettings({ shipbest: { mode: "live", apiId: "id", token: "tok" } });
    }

    // DHL 改成正式环境：正常报价（走正式地址）
    db.saveSettings({ dhl: { ...db.getSettings().dhl!, mode: "live" } });
    try {
      expect(sb.dhlTestOnLive()).toBe(false);
      expect((await sb.getShipBestClient().trialPrice("DHL-P", req))?.totalDiscountShippingFee).toBe(61.2);
      expect(calls.at(-1)?.path).toBe("/mydhlapi/rates");
    } finally {
      db.saveSettings({ dhl: { ...db.getSettings().dhl!, mode: "test" } });
    }
  });

  it("设置页的 DHL 测试环境提醒、服务商反馈里的新动作都有英文", async () => {
    const { translate } = await import("@/lib/i18n");
    const CJK = /[一-鿿]/;
    const src = fs.readFileSync(path.join(__dirname, "..", "src/app/(admin)/settings/page.tsx"), "utf8");
    const keys = [...src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).filter((k) => k.includes("DHL 还是测试环境"));
    expect(keys.length).toBe(1);
    for (const k of [...keys, "重新推送（ShippingLabel）", "模拟取消", sb.DHL_TEST_ON_LIVE_MSG]) expect(translate("en", k), k).not.toMatch(CJK);
  });

  it("提交超时、结果未知：订单留着；刷新 / 取消都找 DHL（不会被分给 ShipBest），刷新提示去 DHL 后台核对，取消转人工", async () => {
    db.saveSettings({ dhl: { ...db.getSettings().dhl!, mode: "live" } });
    try {
      const calls = fakeServers(() => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); });
      const q = (await svc.quoteAll(cid, req)).find((x) => x.ok && x.channelCode === "DHL-P")!;
      const before = ledger.balanceOf(cid);
      const id = await svc.createLabel({ customerId: cid, channelCode: "DHL-P", req, expectedPrice: q.price!, customerRef: "DHL-UNKNOWN", waitForLabel: false });
      const s = db.getShipment(id)!;
      expect(s.status).toBe("pending"); // 结果未知：不删单、不退款
      expect(ledger.balanceOf(cid)).toBeCloseTo(before - q.price!, 2);
      expect(dhl.dhlOrders.get(s.customNo)).toMatchObject({ status: 2, trackingNo: null, productCode: "DHL-P", reference: "DHL-UNKNOWN" });

      const r = await svc.refreshShipment(id);
      expect(r.status).toBe("pending");
      // 按运单上印的参考号（客户订单号）去 DHL 后台核对
      expect(r.errorMsg).toBe(dhl.dhlUnknownMessage("DHL-UNKNOWN", "DHL 接口超时：60 秒没有响应，请稍后再试"));
      const { translateMessage } = await import("@/lib/i18n");
      expect(translateMessage("en", r.errorMsg)).toMatch(/^DHL submission result unknown \(.+\): no DHL waybill number/);
      expect(translateMessage("en", dhl.dhlUnknownMessage("X-1"))).toMatch(/^DHL submission result unknown: .* reference X-1 in MyDHL\+/);

      // 取消：系统确认不了 DHL 有没有建单 → 转人工（取消处理中），不在本地直接作废
      const c = await svc.requestCancel(id);
      expect(c.done).toBe(false);
      const after = db.getShipment(id)!;
      expect(after.status).toBe("cancel_requested");
      expect(after.errorMsg).toContain("确认不了这票有没有在 DHL 建单");
      expect(after.errorMsg).toContain("按参考号 DHL-UNKNOWN 核对");
      expect(translateMessage("en", "DHL 提交结果未知，系统确认不了这票有没有在 DHL 建单，不能自动取消：请到 DHL 后台（MyDHL+）按参考号 PO 12 核对，没有建单或已作废的再点“确认已取消”")).toMatch(/Check reference PO 12 in MyDHL\+/);
      // 查询 / 取消都没有去 ShipBest
      expect(calls.some((x) => x.host !== "express.api.dhl.com")).toBe(false);
    } finally {
      db.saveSettings({ dhl: { ...db.getSettings().dhl!, mode: "test" } });
    }
  });

  it("DHL 客户端：提交前先记一条；出单中不提示，太久没结果才提示核对；DHL 明确拒绝的标成已作废，取消直接算已取消", async () => {
    const cfg = { ...DHL_KEYS, baseUrl: "x", labelTemplate: "ECOM26_A6_002" as const, paperless: true, originCountry: "CN" };
    const base = dhl.mockDhlTransport(() => Buffer.from("%PDF-1.4 mock"));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = new dhl.DhlClient(cfg, async (m, p, b) => {
      if (p === "/shipments") await gate;
      return base(m, p, b);
    });
    const job = slow.createOrder("DC-1", "DHL-P", req);
    await Promise.resolve();
    // 出单中：已经有记录（刷新 / 取消会找 DHL），但还不提示“结果未知”
    expect(dhl.dhlOrders.get("DC-1")).toMatchObject({ status: 2, trackingNo: null });
    expect((await slow.getOrder("DC-1")).errorMsg).toBeNull();
    // 很久都没结果（例如提交时服务器重启了）：提示去 DHL 后台核对
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 3 * 60_000);
    expect((await slow.getOrder("DC-1")).errorMsg).toBe(dhl.dhlUnknownMessage("DC-1"));
    await expect(slow.cancelOrder("DC-1")).rejects.toThrow(/确认不了/);
    vi.useRealTimers();
    release();
    await job;
    expect(await slow.getOrder("DC-1")).toMatchObject({ status: 4, errorMsg: null, labelUrl: "dhl://DC-1" });

    // 路由：有 DHL 记录的单查询 / 取消都交给 DHL
    const sbFake = { verify: async () => {}, getProducts: async () => [], trialPrice: async () => null, createOrder: async () => ({}), getOrder: async () => { throw new Error("不应该查 ShipBest"); }, cancelOrder: async () => { throw new Error("不应该找 ShipBest 取消"); } };
    const multi = new sb.MultiProviderClient(sbFake, null, slow);
    expect((await multi.getOrder({ customNo: "DC-1" })).trackingNo).toMatch(/^\d{10}$/);

    // DHL 明确拒绝：记录标成已作废（DHL 没有建单），取消直接算已取消
    const bad = new dhl.DhlClient(cfg, async (m, p, b) => (p === "/shipments" ? { status: 422, json: { title: "Validation error", detail: "receiver postal code invalid", status: "422" } } : base(m, p, b)));
    await expect(bad.createOrder("DC-2", "DHL-P", req)).rejects.toBeInstanceOf(dhl.DhlError);
    expect(dhl.dhlOrders.get("DC-2")).toMatchObject({ status: 6, error: expect.stringMatching(/^DHL 拒绝出单：.*postal code invalid/) });
    await expect(new sb.MultiProviderClient(sbFake, null, bad).cancelOrder({ customNo: "DC-2" })).resolves.toBeUndefined();
  });
});
