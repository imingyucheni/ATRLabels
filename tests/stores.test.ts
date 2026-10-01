import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-stores-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

describe("电商店铺对接（Shopify / eBay）", () => {
  let db: typeof import("@/lib/db");
  let batch: typeof import("@/lib/batch");
  let stores: typeof import("@/lib/stores");
  let svc: typeof import("@/lib/service");
  let cid: number;
  const pkg = { length: 10, width: 8, height: 4, weight: 1, unit: 3 as const };

  const waitJob = async (jobId: number, st: string[]) => {
    for (let i = 0; i < 150; i++) {
      const j = batch.getJob(jobId)!;
      if (st.includes(j.status)) return j;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("timeout " + batch.getJob(jobId)!.status);
  };

  /** 导入 → 试算 → 提交 → 等面单 */
  const shipAll = async (orderIds: number[]) => {
    const jobId = stores.importToBatch(cid, orderIds, pkg, "customer");
    batch.ensureRunning(jobId);
    await waitJob(jobId, ["ready"]);
    batch.setSelected(jobId, "all");
    batch.confirmJob(jobId);
    const job = await waitJob(jobId, ["done", "ready"]);
    // 模拟面单 1 秒后才出：刷新一下拿到运单号
    await new Promise((r) => setTimeout(r, 1100));
    for (const r of job.rows) if (r.shipmentId) await svc.refreshShipment(r.shipmentId);
    return batch.getJob(jobId)!;
  };

  beforeAll(async () => {
    db = await import("@/lib/db");
    batch = await import("@/lib/batch");
    stores = await import("@/lib/stores");
    svc = await import("@/lib/service");
    const ledger = await import("@/lib/ledger");
    db.saveSettings({ sender: { nameFirst: "ATR", nameLast: "Warehouse", country: "US", province: "CA", city: "Chino", address1: "13950 Central Ave", zipCode: "91710", phone: "9095550100" } });
    await svc.syncChannels();
    cid = db.saveCustomer(null, { name: "网店客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(cid, db.listChannels().map((c) => c.code).filter((c) => !c.startsWith("DHL-")));
    ledger.addLedger({ customerId: cid, type: "topup", amount: 300, createdBy: "admin" });
  });

  it("Shopify 签名校验：参数排序后 HMAC-SHA256，改一个字都不行", async () => {
    const { verifyShopifyHmac, normalizeShop } = await import("@/lib/stores/shopify");
    const p = new URLSearchParams({ shop: "abc.myshopify.com", timestamp: "1700000000", code: "xyz", state: "s1" });
    const msg = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
    p.set("hmac", createHmac("sha256", "secret").update(msg).digest("hex"));
    expect(verifyShopifyHmac(p, "secret")).toBe(true);
    expect(verifyShopifyHmac(p, "other")).toBe(false);
    p.set("shop", "evil.myshopify.com");
    expect(verifyShopifyHmac(p, "secret")).toBe(false);
    expect(normalizeShop("https://My-Store.myshopify.com/admin")).toBe("my-store.myshopify.com");
    expect(normalizeShop("my-store")).toBe("my-store.myshopify.com");
    expect(normalizeShop("evil.com")).toBeNull();
  });

  it("Shopify：同步未发货订单 → 导入批量下单 → 出单后自动回传运单号；取消面单撤回发货", async () => {
    expect(() => stores.saveShopifyStore({ customerId: cid, shop: "real-store.myshopify.com", clientId: "", clientSecret: "" })).toThrow(/Client ID/);
    const id = stores.saveShopifyStore({ customerId: cid, shop: stores.DEMO_SHOPIFY, clientId: "demo" });
    expect(stores.getStore(id)?.status).toBe("connected");
    const r = await stores.syncStore(id);
    expect(r).toMatchObject({ added: 3, total: 3 });
    const open = stores.listStoreOrders(cid, { status: "open" });
    expect(open.map((o) => o.name).sort()).toEqual(["#1001", "#1002", "#1003"]);
    expect(open[0].order.recipient.country).toBe("US");

    const job = await shipAll(open.map((o) => o.id));
    expect(job.rows.every((x) => x.customerRef?.startsWith("#"))).toBe(true);
    expect(job.rows.filter((x) => x.status === "created").length).toBe(3);
    // 再同步：已导入的不会重复出现
    await stores.syncStore(id);
    expect(stores.listStoreOrders(cid, { status: "open" }).length).toBe(0);

    expect(await stores.pushPendingFulfillments()).toBe(3);
    const mock = stores.mockOf(id) as { pushed: { trackingInfo: { number: string; url?: string; company: string }; lineItemsByFulfillmentOrder: unknown[]; notifyCustomer: boolean }[]; cancelled: string[] };
    expect(mock.pushed.length).toBe(3);
    expect(mock.pushed[0].trackingInfo.number).toBeTruthy();
    expect(mock.pushed[0].notifyCustomer).toBe(true);
    const shipped = stores.listStoreOrders(cid, { status: "shipped" });
    expect(shipped.length).toBe(3);
    expect(await stores.pushPendingFulfillments()).toBe(0); // 不会重复回传

    // 取消其中一张：下一轮撤回 Shopify 的发货，订单回到“已导入”
    const sid = shipped[0].shipmentId!;
    db.updateShipment(sid, { status: "cancelled" });
    await stores.pushPendingFulfillments();
    expect(mock.cancelled.length).toBe(1);
    expect(stores.listStoreOrders(cid, { status: "imported" }).map((o) => o.shipmentId)).toEqual([sid]);
  }, 60_000);

  it("eBay：模拟卖家同步、出单、回传物流商和运单号", async () => {
    const id = stores.addDemoEbay(cid);
    await stores.syncStore(id);
    const o = stores.listStoreOrders(cid, { status: "open", storeId: id });
    expect(o.length).toBe(1);
    expect(o[0].order.recipient).toMatchObject({ nameFirst: "Jane", nameLast: "Miller", province: "CO" });
    expect(o[0].order.items[0]).toMatchObject({ sku: "CASE-IP15", quantity: 2, unitPrice: 8.99 });
    await shipAll([o[0].id]);
    await stores.pushPendingFulfillments();
    const mock = stores.mockOf(id) as { pushed: { lineItems: { lineItemId: string; quantity: number }[]; trackingNumber: string; shippingCarrierCode: string }[] };
    expect(mock.pushed.length).toBe(1);
    expect(mock.pushed[0].lineItems).toEqual([{ lineItemId: "10001", quantity: 2 }]);
    expect(mock.pushed[0].trackingNumber).toBeTruthy();
    expect(mock.pushed[0].shippingCarrierCode).toBeTruthy();
  }, 60_000);

  it("真实店铺还没授权：同步会报错并记下原因", async () => {
    const id = stores.saveShopifyStore({ customerId: cid, shop: "second-demo.myshopify.com", clientId: "a", clientSecret: "b" });
    expect(stores.getStore(id)?.status).toBe("pending"); // 真实店铺要授权
    await expect(stores.syncStore(id)).rejects.toThrow(/授权/);
    expect(stores.getStore(id)?.lastError).toMatch(/授权/);
  });

  it("客户自助：eBay 重复点连接不多出行、重新授权沿用原店铺、别人的账号不能连、只能删没在用的", async () => {
    const other = db.saveCustomer(null, { name: "另一个客户", contact: null, phone: null, email: null, note: null, markup: {} });
    const a = stores.startEbayConnection(cid);
    const b = stores.startEbayConnection(cid);
    expect(b.id).toBe(a.id);
    expect(stores.findStoreByState(a.state)).toBeUndefined(); // 旧 state 作废
    const tok = { accessToken: "x", refreshToken: "r", expiresAt: Date.now() + 3600_000, refreshExpiresAt: Date.now() + 86400_000 } as never;
    const first = stores.finishEbayConnection(b.id, tok, "seller_one");
    expect(stores.getStore(first)).toMatchObject({ shop: "seller_one", status: "connected" });
    stores.disconnectStore(first, cid);
    // 断开后重新连接：沿用原来那条
    const again = stores.startEbayConnection(cid);
    expect(again.id).not.toBe(first);
    expect(stores.finishEbayConnection(again.id, tok, "seller_one")).toBe(first);
    expect(stores.getStore(again.id)).toBeNull();
    expect(stores.getStore(first)?.status).toBe("connected");
    // 别的客户想连同一个 eBay 账号
    const x = stores.startEbayConnection(other);
    expect(() => stores.finishEbayConnection(x.id, tok, "seller_one")).toThrow(/其他客户/);
    expect(stores.getStore(x.id)).toBeNull();
    // 删除：连接中的不能删，别人的不能删
    expect(() => stores.deleteMyStore(first, cid)).toThrow(/断开/);
    stores.disconnectStore(first, cid);
    expect(() => stores.deleteMyStore(first, other)).toThrow(/不存在/);
    stores.deleteMyStore(first, cid);
    expect(stores.getStore(first)).toBeNull();
  });

  it("eBay 账户删除通知：challenge 响应、删除买家个人信息", async () => {
    const { ebayChallengeResponse } = await import("@/lib/stores/ebay");
    expect(ebayChallengeResponse("abc", "tok", "https://x/api/stores/ebay/deletion")).toBe(createHash("sha256").update("abctokhttps://x/api/stores/ebay/deletion").digest("hex"));
    expect(stores.forgetEbayUser("buyer_jane")).toBe(1);
    const o = stores.listStoreOrders(cid, { status: "all" }).find((x) => x.platform === "ebay")!;
    expect(o.order.recipient.address1).toBe("");
  });
});
