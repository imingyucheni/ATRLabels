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
    const jobId = stores.importToBatch(cid, orderIds.map((id) => ({ id, pkg })), "customer");
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

  it("测试阶段：默认不开放，后台逐个客户开放 / 关闭", () => {
    expect(stores.storesEnabled(cid)).toBe(false);
    stores.setStoresEnabled(cid, true);
    stores.setStoresEnabled(cid, true);
    expect(stores.storesEnabled(cid)).toBe(true);
    stores.setStoresEnabled(cid, false);
    expect(stores.storesEnabled(cid)).toBe(false);
    stores.setStoresEnabled(cid, true);
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
    expect(stores.countStoreOrders(cid).open).toBe(3);
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

  it("Shopify 订单缺地址 / 收件人被隐藏：照样同步过来但标出来，不能导入", async () => {
    const { normalizeShopifyOrder } = await import("@/lib/stores/shopify");
    const base = {
      id: "gid://shopify/Order/9", name: "#1009", createdAt: "2026-10-01T00:00:00Z",
      lineItems: { nodes: [{ sku: "A", name: "A", quantity: 1, requiresShipping: true }] },
      fulfillmentOrders: { nodes: [{ id: "gid://shopify/FulfillmentOrder/9", status: "OPEN" }] },
    };
    expect(normalizeShopifyOrder({ ...base, shippingAddress: null })?.issue).toBe("no_address");
    const hidden = normalizeShopifyOrder({ ...base, shippingAddress: { firstName: null, lastName: null, address1: null, city: "Ottawa", provinceCode: "ON", zip: "K2P 2L8", countryCodeV2: "CA" } });
    expect(hidden?.issue).toBe("hidden");
    const ok = normalizeShopifyOrder({ ...base, shippingAddress: { firstName: "Karine", lastName: "Ruby", address1: "1 Main St", city: "Ottawa", provinceCode: "ON", zip: "K2P 2L8", countryCodeV2: "CA" } });
    expect(ok?.issue).toBeUndefined();
    const withShip = normalizeShopifyOrder({ ...base, note: " Leave at door ", shippingLine: { title: "Express" }, shippingAddress: { firstName: "A", lastName: "B", address1: "1 Main St", city: "Austin", provinceCode: "TX", zip: "78701", countryCodeV2: "US" } });
    expect(withShip).toMatchObject({ shippingMethod: "Express", note: "Leave at door" });
    // 收货地址没姓名：用账单地址的姓名
    const billName = normalizeShopifyOrder({ ...base, shippingAddress: { address1: "151 O'Connor St", city: "Ottawa", provinceCode: "ON", zip: "K2P 2L8", countryCodeV2: "CA", phone: "+1 613-555-0114" }, billingAddress: { firstName: "Karine", lastName: "Ruby" } });
    expect(billName?.recipient).toMatchObject({ nameFirst: "Karine", nameLast: "Ruby", address1: "151 O'Connor St" });
    expect(billName?.issue).toBeUndefined();
    expect(normalizeShopifyOrder({ ...base, shippingAddress: { address1: "151 O'Connor St", city: "Ottawa", zip: "K2P 2L8", countryCodeV2: "CA" } })?.issue).toBe("hidden");
    expect(normalizeShopifyOrder({ ...base, lineItems: { nodes: [{ sku: "G", name: "Gift card", quantity: 1, requiresShipping: false }] }, shippingAddress: null })).toBeNull();
  });

  it("每单自己的包裹；没有寄件地址时不能导入；发过的商品组合下次自动带出尺寸", async () => {
    const portal = await import("@/lib/portal");
    const id = stores.saveShopifyStore({ customerId: cid, shop: "third-demo.myshopify.com", clientId: "a", clientSecret: "b" });
    stores.saveStoreToken(id, { accessToken: "x", scope: "read_orders" } as never);
    // 直接用模拟店铺的数据：重新连上演示店铺的订单已经在 open 里没有了，这里造两单
    const { normalizeShopifyOrder } = await import("@/lib/stores/shopify");
    const mk = (n: number, sku: string) => normalizeShopifyOrder({
      id: `gid://shopify/Order/7${n}`, name: `#70${n}`, createdAt: "2026-10-01T00:00:00Z",
      shippingAddress: { firstName: "Amy", lastName: "Lee", address1: "1 Main St", city: "Austin", provinceCode: "TX", zip: "78701", countryCodeV2: "US", phone: "5125550100" },
      lineItems: { nodes: [{ sku, name: sku, quantity: 1, requiresShipping: true }] },
      fulfillmentOrders: { nodes: [{ id: `gid://shopify/FulfillmentOrder/7${n}`, status: "OPEN" }] },
    })!;
    const dbc = db.db();
    for (const [n, sku] of [[1, "BOX-A"], [2, "BOX-B"]] as const) dbc.prepare("INSERT INTO store_orders (store_id, ext_id, name, data_json) VALUES (?,?,?,?)").run(id, mk(n, sku).extId, mk(n, sku).name, JSON.stringify(mk(n, sku)));
    const open = stores.listStoreOrders(cid, { status: "open", storeId: id });
    expect(open.length).toBe(2);
    // 没有寄件地址
    const lonely = db.saveCustomer(null, { name: "没寄件地址", contact: null, phone: null, email: null, note: null, markup: {} });
    db.saveSettings({ sender: null as never });
    expect(() => stores.importToBatch(lonely, [{ id: open[0].id, pkg }], "customer")).toThrow(/寄件地址/);
    db.saveSettings({ sender: { nameFirst: "ATR", nameLast: "Warehouse", country: "US", province: "CA", city: "Chino", address1: "13950 Central Ave", zipCode: "91710", phone: "9095550100" } });
    // 尺寸没填完
    expect(() => stores.importToBatch(cid, [{ id: open[0].id, pkg: { ...pkg, height: 0 } }], "customer")).toThrow(/长、宽、高/);
    const a = open.find((o) => o.name === "#701")!, b = open.find((o) => o.name === "#702")!;
    const jobId = stores.importToBatch(cid, [{ id: a.id, pkg: { length: 6, width: 6, height: 6, weight: 0.5, unit: 3 } }, { id: b.id, pkg: { length: 20, width: 12, height: 10, weight: 7, unit: 3 } }], "customer");
    const rows = batch.getJob(jobId)!.rows;
    const byRef = Object.fromEntries(rows.map((r) => [r.customerRef, r.pkg]));
    expect(byRef["#701"]).toBe("6×6×6 in · 0.5 lb");
    expect(byRef["#702"]).toBe("20×12×10 in · 7 lb");
    expect(portal.skuComboKey([{ sku: "b", quantity: 2 }, { sku: "A", quantity: 1 }])).toBe("A×1|B×2");
    // 已出过单的商品组合能认出来（前面 Shopify 演示店铺发过 TS-BLK-M ×1）
    const combos = portal.packagesBySkuCombo(cid);
    expect(combos.get("TS-BLK-M×1")).toMatchObject({ length: 10, width: 8, height: 4 });
  }, 60_000);

  it("替客户开通：安装链接只收 Shopify 网址，保存凭证时不填就保留", () => {
    expect(() => stores.normalizeInstallUrl("https://evil.com/install")).toThrow(/安装链接/);
    expect(() => stores.normalizeInstallUrl("http://admin.shopify.com/x")).toThrow(/安装链接/);
    const link = "https://admin.shopify.com/store/cust-a/oauth/install_custom_app?client_id=abc&signature=xyz";
    const id = stores.saveShopifyStore({ customerId: cid, shop: "cust-a.myshopify.com", clientId: "abc", clientSecret: "s", installUrl: link });
    expect(stores.getStore(id)?.installUrl).toBe(link);
    stores.saveShopifyStore({ id, customerId: cid, shop: "cust-a.myshopify.com", clientId: "abc" }); // 客户自己改设置：不碰安装链接
    expect(stores.getStore(id)?.installUrl).toBe(link);
    stores.saveShopifyStore({ id, customerId: cid, shop: "cust-a.myshopify.com", clientId: "abc", installUrl: "" });
    expect(stores.getStore(id)?.installUrl).toBeNull();
    stores.deleteStore(id);
  });

  it("模拟面单只回传到测试店铺：正式店铺不回传；判断结果记在店铺上", async () => {
    const { ShopifyAdapter } = await import("@/lib/stores/shopify");
    const plan = (dev: boolean, name = "Basic") => new ShopifyAdapter((async () => ({ shop: { plan: { partnerDevelopment: dev, publicDisplayName: name } } })) as never);
    expect(await plan(true).isSandbox()).toBe(true);
    expect(await plan(false, "Development").isSandbox()).toBe(true);
    expect(await plan(false, "Grow").isSandbox()).toBe(false);
    const { EbayAdapter } = await import("@/lib/stores/ebay");
    expect(await new EbayAdapter((async () => ({})) as never, false).isSandbox()).toBe(false);
    expect(await new EbayAdapter((async () => ({})) as never, true).isSandbox()).toBe(true);
  });

  it("只同步已付款的订单（eBay 没付款的不要）", async () => {
    const { normalizeEbayOrder } = await import("@/lib/stores/ebay");
    const base = {
      orderId: "1-1", creationDate: "2026-10-01T00:00:00Z", orderFulfillmentStatus: "NOT_STARTED",
      fulfillmentStartInstructions: [{ shippingStep: { shipTo: { fullName: "A B", contactAddress: { addressLine1: "1 Main", city: "Austin", stateOrProvince: "TX", postalCode: "78701", countryCode: "US" } } } }],
      lineItems: [{ lineItemId: "1", sku: "X", title: "X", quantity: 1 }],
    };
    expect(normalizeEbayOrder({ ...base, orderPaymentStatus: "PENDING" } as never)).toBeNull();
    expect(normalizeEbayOrder({ ...base, orderPaymentStatus: "PAID" } as never)).not.toBeNull();
  });

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
