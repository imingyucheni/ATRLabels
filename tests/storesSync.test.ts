import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-storesync-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

/* ---------- 假的 Shopify 店铺（拦下 fetch，不连真实接口） ---------- */

type FakeShop = {
  orders: Record<string, unknown>[];
  /** 每页几单；morePages = true 时永远说还有下一页（模拟几千单） */
  perPage?: number;
  morePages?: boolean;
  /** 按 ID 查订单状态：不在这里的按“还没发货”回 */
  states?: Record<string, "cancelled" | "fulfilled" | "open">;
  /** 回传发货时返回的错误 */
  pushError?: string;
  /** 只认这个访问令牌（不对回 401） */
  token?: string;
  /** 刷新令牌：对得上就换成 newToken */
  refresh?: { from: string; to: string; newToken: string; status?: number };
  pushed: unknown[];
  refreshed: number;
};
const shops = new Map<string, FakeShop>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function fakeFetch(input: unknown, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const m = url.match(/^https:\/\/([^/]+)\/admin\/(oauth\/access_token|api\/[^/]+\/graphql\.json)$/);
  const shop = m ? shops.get(m[1]) : undefined;
  if (!m || !shop) throw new Error(`测试里不能访问外部接口：${url}`);
  if (m[2] === "oauth/access_token") {
    const p = new URLSearchParams(String(init?.body));
    const r = shop.refresh;
    if (p.get("grant_type") !== "refresh_token" || !r || p.get("refresh_token") !== r.from || p.get("client_secret") !== "sec") return json({ error: "invalid_grant", error_description: "refresh token is invalid" }, r?.status ?? 400);
    shop.refreshed++;
    shop.token = r.newToken;
    return json({ access_token: r.newToken, expires_in: 3600, refresh_token: r.to, refresh_token_expires_in: 86400 * 90, scope: "read_orders" });
  }
  const headers = new Headers(init?.headers);
  if (shop.token && headers.get("X-Shopify-Access-Token") !== shop.token) return json({ errors: "Invalid API key or access token" }, 401);
  const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables?: Record<string, any> };
  if (query.includes("partnerDevelopment")) return json({ data: { shop: { plan: { partnerDevelopment: true, publicDisplayName: "Development" } } } });
  if (query.includes("fulfillmentCreate")) {
    if (shop.pushError) return json({ data: { fulfillmentCreate: { fulfillment: null, userErrors: [{ field: null, message: shop.pushError }] } } });
    shop.pushed.push(variables?.fulfillment);
    return json({ data: { fulfillmentCreate: { fulfillment: { id: `gid://shopify/Fulfillment/${shop.pushed.length}`, status: "SUCCESS" }, userErrors: [] } } });
  }
  if (query.includes("nodes(ids")) {
    return json({
      data: {
        nodes: (variables!.ids as string[]).map((id) => {
          const st = shop.states?.[id] ?? "open";
          return { id, cancelledAt: st === "cancelled" ? "2026-10-01T00:00:00Z" : null, displayFulfillmentStatus: st === "fulfilled" ? "FULFILLED" : "UNFULFILLED" };
        }),
      },
    });
  }
  // 订单列表（分页）
  const per = shop.perPage ?? 50;
  const start = variables?.cursor ? Number(variables.cursor) : 0;
  const nodes = shop.orders.slice(start, start + per);
  const hasNextPage = shop.morePages || start + per < shop.orders.length;
  return json({ data: { orders: { pageInfo: { hasNextPage, endCursor: String(start + per) }, nodes } } });
}

const gqlOrder = (n: number, o: { name?: string; first?: string; last?: string; country?: string; province?: string; city?: string; zip?: string } = {}) => ({
  id: `gid://shopify/Order/${n}`,
  name: o.name ?? `#${n}`,
  createdAt: new Date(Date.now() - n * 1000).toISOString(),
  email: null,
  phone: null,
  totalWeight: 500,
  shippingAddress: {
    firstName: o.first ?? "Amy", lastName: o.last ?? "Lee", company: null, address1: "500 Congress Ave", address2: null,
    city: o.city ?? "Austin", provinceCode: o.province ?? "TX", zip: o.zip ?? "78701", countryCodeV2: o.country ?? "US", phone: "5125550100",
  },
  lineItems: { nodes: [{ sku: `SKU-${n}`, name: "Mug", quantity: 1, requiresShipping: true, originalUnitPriceSet: { shopMoney: { amount: "10.00", currencyCode: "USD" } } }] },
  fulfillmentOrders: { nodes: [{ id: `gid://shopify/FulfillmentOrder/${n}`, status: "OPEN" }] },
});

describe("店铺订单：撞号、没拉全、店铺里取消 / 发货、回传重试、授权过期", () => {
  let db: typeof import("@/lib/db");
  let batch: typeof import("@/lib/batch");
  let stores: typeof import("@/lib/stores");
  let svc: typeof import("@/lib/service");
  let cid: number;
  const pkg = { length: 10, width: 8, height: 4, weight: 1, unit: 3 as const };

  const waitJob = async (jobId: number, st: string[]) => {
    for (let i = 0; i < 200; i++) {
      const j = batch.getJob(jobId)!;
      if (st.includes(j.status)) return j;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("timeout " + batch.getJob(jobId)!.status);
  };
  const importAndQuote = async (ids: number[]) => {
    const jobId = stores.importToBatch(cid, ids.map((id) => ({ id, pkg })), "customer");
    batch.ensureRunning(jobId);
    return { jobId, job: await waitJob(jobId, ["ready"]) };
  };
  /** 提交勾选的单，等面单出好（模拟面单 1 秒后才有运单号） */
  const submit = async (jobId: number) => {
    batch.confirmJob(jobId);
    const job = await waitJob(jobId, ["done", "ready"]);
    await new Promise((r) => setTimeout(r, 1100));
    for (const r of job.rows) if (r.shipmentId) await svc.refreshShipment(r.shipmentId);
    return batch.getJob(jobId)!;
  };
  /** 接一个假的 Shopify 店铺（已授权） */
  const connect = (shop: string, fake: Partial<FakeShop>, token: Record<string, unknown> = { accessToken: "tok" }) => {
    shops.set(shop, { orders: [], pushed: [], refreshed: 0, token: String(token.accessToken), ...fake });
    const id = stores.saveShopifyStore({ customerId: cid, shop, clientId: "cid", clientSecret: "sec" });
    stores.saveStoreToken(id, token as never);
    return id;
  };
  const storeRow = (id: number) => db.db().prepare("SELECT * FROM store_orders WHERE id = ?").get(id) as { status: string; push_note: string | null; push_error: string | null; push_attempts: number };
  const orderOf = (storeId: number, extNo: number) => stores.listStoreOrders(cid, { status: "all", storeId }).find((o) => o.extId === `gid://shopify/Order/${extNo}`)!;

  beforeAll(async () => {
    vi.stubGlobal("fetch", fakeFetch);
    db = await import("@/lib/db");
    batch = await import("@/lib/batch");
    stores = await import("@/lib/stores");
    svc = await import("@/lib/service");
    const ledger = await import("@/lib/ledger");
    db.saveSettings({ sender: { nameFirst: "ATR", nameLast: "Warehouse", country: "US", province: "CA", city: "Chino", address1: "13950 Central Ave", zipCode: "91710", phone: "9095550100" } });
    await svc.syncChannels();
    cid = db.saveCustomer(null, { name: "多店铺客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(cid, ["LP10210028", "LP10210029", "LP10210030"]);
    ledger.addLedger({ customerId: cid, type: "topup", amount: 500, createdBy: "admin" });
    stores.setStoresEnabled(cid, true);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("两个 Shopify 店铺的 #1001 不再撞号：订单号前面加店铺简称；以前用原单号下过的单只提醒、默认不勾选", async () => {
    const a = connect("shop-a.myshopify.com", { orders: [gqlOrder(1, { name: "#1001" })] });
    const b = connect("shop-b.myshopify.com", { orders: [gqlOrder(2, { name: "#1001" })] });
    await stores.syncStore(a);
    await stores.syncStore(b);
    const open = stores.listStoreOrders(cid, { status: "open" });
    expect(open.map((o) => o.name)).toEqual(["#1001", "#1001"]);
    expect(stores.storeOrderRef("shopify", "shop-a", "#1001")).toBe("shop-a #1001");
    expect(stores.storeOrderRef("ebay", "eBay · seller", "12-34567-89012")).toBe("12-34567-89012");
    expect(stores.storeOrderRef("shopify", "a-very-long-shopify-store-handle-for-testing", "#100001").length).toBeLessThanOrEqual(50);

    // 以前（没加简称时）用 #1001 下过一单
    const legacyReq = stores.toShipmentRequest(open[0].order, db.getSettings().sender!, pkg);
    const q = (await svc.quoteAll(cid, legacyReq)).find((x) => x.ok)!;
    await svc.createLabel({ customerId: cid, channelCode: q.channelCode, req: legacyReq, expectedPrice: q.price!, customerRef: "#1001", waitForLabel: false });

    const { jobId, job } = await importAndQuote(open.map((o) => o.id));
    expect(job.rows.map((r) => r.customerRef).sort()).toEqual(["shop-a #1001", "shop-b #1001"]);
    expect(job.rows.every((r) => r.status === "quoted" && !r.error)).toBe(true);
    expect(job.rows.every((r) => !r.selected && r.warningKind === "other" && /以前下过单/.test(r.warning!))).toBe(true);
    const { translateMessage } = await import("@/lib/i18n");
    expect(translateMessage("en", job.rows[0].warning)).toMatch(/was shipped before/);
    // 客户确认后两单都能出
    batch.setSelected(jobId, "all");
    const done = await submit(jobId);
    expect(done.rows.filter((r) => r.status === "created").length).toBe(2);
    // 回传：各自回到自己的店铺
    expect(await stores.pushPendingFulfillments()).toBe(2);
    expect(shops.get("shop-a.myshopify.com")!.pushed.length).toBe(1);
    expect(shops.get("shop-b.myshopify.com")!.pushed.length).toBe(1);
  }, 60_000);

  it("待发货订单太多、只拉了一部分：没拉到的订单不关闭；拉全了才关", async () => {
    const { ShopifyAdapter, SHOPIFY_MAX_PAGES } = await import("@/lib/stores/shopify");
    let pages = 0;
    const endless = new ShopifyAdapter((async () => {
      pages++;
      return { orders: { pageInfo: { hasNextPage: true, endCursor: String(pages) }, nodes: [gqlOrder(100 + pages)] } };
    }) as never);
    const r = await endless.fetchOpenOrders();
    expect(r.complete).toBe(false);
    expect(pages).toBe(SHOPIFY_MAX_PAGES);
    const { EbayAdapter } = await import("@/lib/stores/ebay");
    const ebay = new EbayAdapter((async () => ({ status: 200, json: { orders: [], next: "https://api.ebay.com/sell/fulfillment/v1/order?offset=100" } })) as never);
    expect((await ebay.fetchOpenOrders()).complete).toBe(false);
    const ebayDone = new EbayAdapter((async () => ({ status: 200, json: { orders: [] } })) as never);
    expect((await ebayDone.fetchOpenOrders()).complete).toBe(true);

    // 店铺里有很多单：这次只拉到最新的 2 页，更早的一单（第 3 页）不能被关掉
    const orders = [gqlOrder(201), gqlOrder(202), gqlOrder(203)];
    const id = connect("shop-c.myshopify.com", { orders, perPage: 1 });
    await stores.syncStore(id);
    expect(stores.listStoreOrders(cid, { status: "open", storeId: id }).length).toBe(3);
    shops.get("shop-c.myshopify.com")!.orders = [gqlOrder(201), gqlOrder(202)];
    shops.get("shop-c.myshopify.com")!.morePages = true; // 还有下一页（几千单）
    const r1 = await stores.syncStore(id);
    expect(r1.closed).toBe(0);
    expect(orderOf(id, 203).status).toBe("open");
    // 拉全了，它确实不在待发货列表里了：关闭
    shops.get("shop-c.myshopify.com")!.morePages = false;
    const r2 = await stores.syncStore(id);
    expect(r2.closed).toBe(1);
    expect(orderOf(id, 203).status).toBe("closed");
  }, 30_000);

  it("导入后店铺里取消了：订单关闭、批次里那一单取消勾选并提醒；又回到待发货时恢复", async () => {
    const id = stores.saveShopifyStore({ customerId: cid, shop: stores.DEMO_SHOPIFY, clientId: "demo" });
    await stores.syncStore(id);
    const mock = stores.mockOf(id) as unknown as { gone: Map<string, string>; pushed: unknown[] };
    const o1 = orderOf(id, 5001), o2 = orderOf(id, 5002);
    const { jobId, job } = await importAndQuote([o1.id, o2.id]);
    expect(job.rows.every((r) => r.status === "quoted")).toBe(true);
    // 第一个用例里用 #1001 下过单：atr-demo #1001 带着“以前下过单”的提醒（下面要保留）
    const legacy = job.rows.find((r) => r.customerRef === "atr-demo #1001")!.warning!;
    expect(legacy).toMatch(/以前下过单/);
    batch.setSelected(jobId, "all");
    mock.gone.set("gid://shopify/Order/5001", "cancelled");
    mock.gone.set("gid://shopify/Order/5002", "open"); // 暂停发货：不在列表里，但还要发
    await stores.syncStore(id);
    expect(orderOf(id, 5001)).toMatchObject({ status: "closed", pushNote: stores.STORE_NOTE.cancelled });
    expect(orderOf(id, 5002).status).toBe("imported");
    let rows = batch.getJob(jobId)!.rows;
    const r1 = rows.find((r) => r.customerRef === "atr-demo #1001")!;
    const r2 = rows.find((r) => r.customerRef === "atr-demo #1002")!;
    expect(r1).toMatchObject({ selected: false, warningKind: "store", warning: `${batch.STORE_GONE_WARNING}；${legacy}` });
    expect(r2).toMatchObject({ selected: true, warning: null });
    // 提交时会跳过取消勾选的那一单（这里先不提交）
    const { translateMessage } = await import("@/lib/i18n");
    expect(translateMessage("en", batch.STORE_GONE_WARNING)).toMatch(/cancelled or fulfilled elsewhere/);
    // 店铺里又放出来了（例如取消被撤回）：恢复成已导入，提醒去掉，不替客户重新勾选
    mock.gone.delete("gid://shopify/Order/5001");
    mock.gone.delete("gid://shopify/Order/5002");
    await stores.syncStore(id);
    expect(orderOf(id, 5001)).toMatchObject({ status: "imported", pushNote: null });
    rows = batch.getJob(jobId)!.rows;
    expect(rows.find((r) => r.customerRef === "atr-demo #1001")).toMatchObject({ selected: false, warning: legacy, warningKind: "other" });

    // 已经出了面单，店铺里却在别处发货了：关闭、不回传，提醒客户面单不用就取消
    batch.setSelected(jobId, [r2.id]);
    await submit(jobId);
    mock.gone.set("gid://shopify/Order/5002", "fulfilled");
    await stores.syncStore(id);
    expect(orderOf(id, 5002)).toMatchObject({ status: "closed", pushNote: stores.STORE_NOTE_LABELED.fulfilled });
    expect(await stores.pushPendingFulfillments()).toBe(0);
    expect(mock.pushed.length).toBe(0);
    expect(translateMessage("en", stores.STORE_NOTE_LABELED.fulfilled)).toMatch(/already shows this order as fulfilled/);
    expect(translateMessage("en", stores.STORE_NOTE_LABELED.cancelled)).toMatch(/tracking number wasn't pushed/);
  }, 60_000);

  it("eBay：买家取消了已导入的订单 → 关闭并取消勾选", async () => {
    const id = stores.addDemoEbay(cid);
    await stores.syncStore(id);
    const o = stores.listStoreOrders(cid, { status: "open", storeId: id })[0];
    const { jobId } = await importAndQuote([o.id]);
    (stores.mockOf(id) as unknown as { cancelled: Set<string> }).cancelled.add(o.extId);
    await stores.syncStore(id);
    expect(stores.listStoreOrders(cid, { status: "all", storeId: id })[0]).toMatchObject({ status: "closed", pushNote: stores.STORE_NOTE.cancelled });
    expect(batch.getJob(jobId)!.rows[0]).toMatchObject({ selected: false, warningKind: "store" });
  }, 30_000);

  it("回传失败：最多自动重试 5 次，之后停下来提示手动处理；店铺说已取消的马上停", async () => {
    const id = connect("shop-d.myshopify.com", { orders: [gqlOrder(301), gqlOrder(302)], pushError: "Fulfillment order is not in an open state" });
    await stores.syncStore(id);
    const { jobId } = await importAndQuote([orderOf(id, 301).id, orderOf(id, 302).id]);
    await submit(jobId);
    const fake = shops.get("shop-d.myshopify.com")!;
    fake.states = { "gid://shopify/Order/302": "cancelled" };
    const o1 = orderOf(id, 301), o2 = orderOf(id, 302);
    const age = () => db.db().prepare("UPDATE store_orders SET updated_at = datetime('now', '-1 hour') WHERE store_id = ?").run(id);
    expect(await stores.pushPendingFulfillments()).toBe(0);
    // 店铺说 302 已取消：不再重试
    expect(storeRow(o2.id)).toMatchObject({ status: "closed", push_note: stores.STORE_NOTE_LABELED.cancelled });
    expect(storeRow(o1.id)).toMatchObject({ status: "imported", push_attempts: 1, push_note: null });
    // 30 分钟内不重试
    await stores.pushPendingFulfillments();
    expect(storeRow(o1.id).push_attempts).toBe(1);
    for (let i = 2; i <= stores.MAX_PUSH_ATTEMPTS; i++) {
      age();
      await stores.pushPendingFulfillments();
      expect(storeRow(o1.id).push_attempts).toBe(i);
    }
    expect(storeRow(o1.id)).toMatchObject({ status: "imported", push_note: stores.PUSH_GAVE_UP_NOTE });
    expect(storeRow(o1.id).push_error).toMatch(/not in an open state/);
    age();
    await stores.pushPendingFulfillments();
    expect(storeRow(o1.id).push_attempts).toBe(stores.MAX_PUSH_ATTEMPTS);
    expect(orderOf(id, 301)).toMatchObject({ pushNote: stores.PUSH_GAVE_UP_NOTE });
    // 重新授权后再给几次机会（多半就是授权的问题）
    stores.saveStoreToken(id, { accessToken: "tok" } as never);
    expect(storeRow(o1.id)).toMatchObject({ push_attempts: 0, push_note: null });
    // 店铺断开 / 授权失效时回传不了：不占重试次数
    stores.disconnectStore(id, cid);
    age();
    await stores.pushPendingFulfillments();
    expect(storeRow(o1.id).push_attempts).toBe(0);
    expect(storeRow(o1.id).push_error).toMatch(/授权/);
    // 重新连上、店铺恢复正常：照常回传
    stores.saveStoreToken(id, { accessToken: "tok" } as never);
    shops.get("shop-d.myshopify.com")!.pushError = undefined;
    age();
    expect(await stores.pushPendingFulfillments()).toBe(1);
    expect(storeRow(o1.id)).toMatchObject({ status: "shipped", push_attempts: 0, push_error: null });
  }, 60_000);

  it("只有一个名字的收件人：姓也用它（不会报“收件人姓必填”）", async () => {
    const { normalizeShopifyOrder } = await import("@/lib/stores/shopify");
    const { normalizeEbayOrder } = await import("@/lib/stores/ebay");
    expect(normalizeShopifyOrder(gqlOrder(1, { first: "Madonna", last: "" }) as never)!.recipient).toMatchObject({ nameFirst: "Madonna", nameLast: "Madonna" });
    expect(normalizeShopifyOrder(gqlOrder(1, { first: "", last: "Cher" }) as never)!.recipient).toMatchObject({ nameFirst: "Cher", nameLast: "Cher" });
    const eb = normalizeEbayOrder({
      orderId: "1-1", creationDate: "2026-10-01T00:00:00Z", orderPaymentStatus: "PAID",
      fulfillmentStartInstructions: [{ shippingStep: { shipTo: { fullName: "Prince", contactAddress: { addressLine1: "1 Main St", city: "Austin", stateOrProvince: "TX", postalCode: "78701", countryCode: "US" } } } }],
      lineItems: [{ lineItemId: "1", sku: "X", title: "X", quantity: 1 }],
    } as never)!;
    expect(eb.recipient).toMatchObject({ nameFirst: "Prince", nameLast: "Prince" });
    // 以前同步下来、姓是空的订单：导入时补上；邮编统一写法
    const old = { ...normalizeShopifyOrder(gqlOrder(1) as never)!, recipient: { nameFirst: "Prince", nameLast: "", country: "US", province: "MA", city: "Boston", address1: "1 Main St", zipCode: "021101234" } };
    const req = stores.toShipmentRequest(old, db.getSettings().sender!, pkg);
    expect(req.recipient).toMatchObject({ nameLast: "Prince", zipCode: "02110-1234" });
    expect(svc.validateRequest(req)).toEqual([]);
  });

  it("国际件的店铺订单：导入时说明要去“国际下单”，不报一堆校验错误", async () => {
    const id = connect("shop-intl.myshopify.com", { orders: [gqlOrder(401, { country: "CA", province: "ON", city: "Toronto", zip: "M5H 2N2" })] });
    await stores.syncStore(id);
    const { job } = await importAndQuote([orderOf(id, 401).id]);
    expect(job.rows[0]).toMatchObject({ status: "error", error: batch.INTL_IMPORT_MSG, selected: false });
  }, 30_000);

  it("Shopify 令牌过期：有刷新令牌就先换新的再同步；换不了标记“要重新连接”，店铺卡片上看得到", async () => {
    const expired = Date.now() - 1000;
    const id = connect("shop-e.myshopify.com", { orders: [gqlOrder(501)], refresh: { from: "r1", to: "r2", newToken: "fresh" } }, { accessToken: "stale", refreshToken: "r1", expiresAt: expired });
    shops.get("shop-e.myshopify.com")!.token = "fresh"; // 店铺只认新令牌
    expect(await stores.syncStore(id)).toMatchObject({ added: 1 });
    expect(shops.get("shop-e.myshopify.com")!.refreshed).toBe(1);
    const saved = JSON.parse((db.db().prepare("SELECT token_json FROM store_connections WHERE id = ?").get(id) as { token_json: string }).token_json);
    expect(saved).toMatchObject({ accessToken: "fresh", refreshToken: "r2" });
    expect(saved.expiresAt).toBeGreaterThan(Date.now());
    // 再同步：令牌还新，不用再换
    await stores.syncStore(id);
    expect(shops.get("shop-e.myshopify.com")!.refreshed).toBe(1);

    // 过期了又没有刷新令牌：不再悄悄失败，店铺标成“连接出错”并写明要重新连接
    const noRefresh = connect("shop-f.myshopify.com", { orders: [gqlOrder(601)] }, { accessToken: "tok", expiresAt: expired });
    await expect(stores.syncStore(noRefresh)).rejects.toThrow(/授权已失效/);
    expect(stores.getStore(noRefresh)).toMatchObject({ status: "error", lastError: expect.stringMatching(/重新连接/) });
    // 刷新令牌被 Shopify 拒绝
    const rejected = connect("shop-g.myshopify.com", { orders: [], refresh: { from: "other", to: "x", newToken: "y" } }, { accessToken: "tok", refreshToken: "bad", expiresAt: expired });
    await expect(stores.syncStore(rejected)).rejects.toThrow(/授权已失效/);
    expect(stores.getStore(rejected)?.status).toBe("error");
    // 令牌被撤销（401）：同样标记
    const revoked = connect("shop-h.myshopify.com", { orders: [], token: "something-else" });
    await expect(stores.syncStore(revoked)).rejects.toThrow(/授权已失效/);
    expect(stores.getStore(revoked)?.status).toBe("error");
    // 自动同步不再去碰“连接出错”的店铺；重新授权后恢复
    stores.saveStoreToken(revoked, { accessToken: "something-else" } as never);
    expect(stores.getStore(revoked)?.status).toBe("connected");
    const { translateMessage } = await import("@/lib/i18n");
    expect(translateMessage("en", stores.getStore(rejected)!.lastError)).toMatch(/reconnect/);

    // eBay 的刷新令牌（约 18 个月）也过期了：同样标记要重新授权（不去请求 eBay）
    db.saveSettings({ ebay: { enabled: true, env: "sandbox", clientId: "app", clientSecret: "cert", ruName: "ru", verificationToken: "" } });
    const e = stores.startEbayConnection(cid);
    const ebayId = stores.finishEbayConnection(e.id, { accessToken: "a", expiresAt: expired, refreshToken: "r", refreshExpiresAt: expired }, "old_seller");
    await expect(stores.syncStore(ebayId)).rejects.toThrow(/eBay 授权已过期/);
    expect(stores.getStore(ebayId)).toMatchObject({ status: "error", lastError: stores.EBAY_RECONNECT });
  }, 30_000);
});
