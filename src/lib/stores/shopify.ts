/**
 * Shopify 对接（每个店铺一个“自定义分发”App，Dev Dashboard 里创建，不需要 Shopify 审核）。
 * - 授权：店主用安装链接装好 App → Shopify 打开我们的 App URL → 走 OAuth 拿到访问令牌
 * - 订单：GraphQL Admin API 拉未发货订单（收件人、商品、重量、fulfillment order）
 * - 回传：fulfillmentCreate 写入运单号和追踪链接，Shopify 会给买家发发货通知
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Address } from "../shipbest/types";
import { StoreAuthError, type FetchedOrders, type PlatformAdapter, type StoreOrder, type StoreOrderState, type TrackingPush } from "./types";

export const SHOPIFY_API_VERSION = "2026-07";
export const SHOPIFY_SCOPES = "read_orders,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders";

/** 店铺域名统一成 xxx.myshopify.com；不合法返回 null */
export function normalizeShop(raw: string | null | undefined): string | null {
  let s = (raw ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (s && !s.includes(".")) s = `${s}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s) ? s : null;
}

/** Shopify 回调 / 打开 App 时带的 hmac 校验（防止伪造请求） */
export function verifyShopifyHmac(params: URLSearchParams, secret: string): boolean {
  const hmac = params.get("hmac");
  if (!hmac || !secret) return false;
  const msg = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const digest = createHmac("sha256", secret).update(msg).digest("hex");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hmac, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function shopifyAuthorizeUrl(shop: string, clientId: string, redirectUri: string, state: string) {
  const q = new URLSearchParams({ client_id: clientId, scope: SHOPIFY_SCOPES, redirect_uri: redirectUri, state });
  return `https://${shop}/admin/oauth/authorize?${q}`;
}

export type ShopifyToken = { accessToken: string; scope?: string; refreshToken?: string; expiresAt?: number | null; refreshExpiresAt?: number | null };

/** Shopify 说授权不能用了（令牌被撤销、刷新令牌失效、App 被卸载）：要店主重新连接，不是临时的网络问题 */
export class ShopifyAuthError extends StoreAuthError {}

/** 授权已失效时给客户看的话（店铺卡片上显示，点“重新授权”就好） */
export const SHOPIFY_RECONNECT = "Shopify 授权已失效，请重新连接店铺";

type TokenJson = { access_token?: string; scope?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; error?: string; error_description?: string };

function tokenFrom(j: TokenJson, oldRefresh?: string): ShopifyToken {
  return {
    accessToken: j.access_token!,
    scope: j.scope,
    refreshToken: j.refresh_token || oldRefresh,
    expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : null,
    refreshExpiresAt: j.refresh_token_expires_in ? Date.now() + j.refresh_token_expires_in * 1000 : null,
  };
}

/** 用授权码换访问令牌 */
export async function exchangeShopifyCode(shop: string, clientId: string, clientSecret: string, code: string): Promise<ShopifyToken> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as TokenJson;
  if (!res.ok || !j.access_token) throw new Error(`Shopify 授权失败：${j.error_description || `HTTP ${res.status}`}`);
  return tokenFrom(j);
}

/**
 * 会过期的访问令牌（授权时 Shopify 给了 expires_in 和 refresh_token）：用刷新令牌换一个新的。
 * 按 OAuth 标准的 refresh_token 方式请求同一个 access_token 地址；Shopify 拒绝（4xx）时抛 ShopifyAuthError，要重新连接。
 */
export async function refreshShopifyToken(shop: string, clientId: string, clientSecret: string, refreshToken: string): Promise<ShopifyToken> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as TokenJson;
  if (!res.ok || !j.access_token) {
    const why = j.error_description || j.error || `HTTP ${res.status}`;
    if (res.status >= 400 && res.status < 500) throw new ShopifyAuthError(`${SHOPIFY_RECONNECT}（${why}）`);
    throw new Error(`Shopify 授权刷新失败：${why}`);
  }
  return tokenFrom(j, refreshToken);
}

/** 发 GraphQL 请求的函数（测试 / 演示可以换成假的） */
export type ShopifyGraphql = (query: string, variables?: Record<string, unknown>) => Promise<any>;

/** accessToken 可以传一个函数：每次请求前取（令牌快过期时在里面先刷新） */
export function shopifyHttp(shop: string, accessToken: string | (() => Promise<string>)): ShopifyGraphql {
  const token = typeof accessToken === "string" ? async () => accessToken : accessToken;
  return async (query, variables) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await token() },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
      // 限流：等一会儿再试（最多 3 次）
      if (res.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new ShopifyAuthError(SHOPIFY_RECONNECT);
      const j = (await res.json().catch(() => null)) as { data?: unknown; errors?: { message: string; extensions?: { code?: string } }[] } | null;
      if (!j) throw new Error(`Shopify 接口返回异常（HTTP ${res.status}）`);
      if (j.errors?.some((e) => e.extensions?.code === "THROTTLED") && attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (j.errors?.length) throw new Error(`Shopify：${j.errors.map((e) => e.message).join("；")}`);
      return j.data;
    }
  };
}

const ORDERS_QUERY = `query Orders($cursor: String) {
  orders(first: 50, after: $cursor, sortKey: CREATED_AT, reverse: true, query: "status:open AND (fulfillment_status:unshipped OR fulfillment_status:partial) AND (financial_status:paid OR financial_status:partially_paid OR financial_status:partially_refunded OR financial_status:authorized)") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt email phone totalWeight note
      shippingLine { title }
      shippingAddress { firstName lastName company address1 address2 city provinceCode zip countryCodeV2 phone }
      billingAddress { firstName lastName phone }
      lineItems(first: 50) { nodes { sku name quantity requiresShipping originalUnitPriceSet { shopMoney { amount currencyCode } } } }
      fulfillmentOrders(first: 10) { nodes { id status requestStatus } }
    }
  }
}`;

type GqlOrder = {
  id: string; name: string; createdAt: string; email?: string | null; phone?: string | null; totalWeight?: string | number | null; note?: string | null;
  shippingLine?: { title?: string | null } | null;
  billingAddress?: { firstName?: string | null; lastName?: string | null; phone?: string | null } | null;
  shippingAddress?: { firstName?: string | null; lastName?: string | null; company?: string | null; address1?: string | null; address2?: string | null; city?: string | null; provinceCode?: string | null; zip?: string | null; countryCodeV2?: string | null; phone?: string | null } | null;
  lineItems: { nodes: { sku?: string | null; name: string; quantity: number; requiresShipping?: boolean; originalUnitPriceSet?: { shopMoney?: { amount: string; currencyCode: string } } }[] };
  fulfillmentOrders: { nodes: { id: string; status: string; requestStatus?: string }[] };
};

export function normalizeShopifyOrder(o: GqlOrder): StoreOrder | null {
  const a = o.shippingAddress;
  const items = o.lineItems.nodes.filter((l) => l.requiresShipping !== false && l.quantity > 0);
  // 没有要发货的商品（虚拟商品等）：不用管
  if (!items.length) return null;
  const addr: NonNullable<GqlOrder["shippingAddress"]> = a ?? {};
  // 收货地址没写姓名时（Shopify 允许），用账单地址上的姓名
  const named = (addr.firstName ?? "").trim() || (addr.lastName ?? "").trim() ? addr : (o.billingAddress ?? {});
  const first = (named.firstName ?? "").trim();
  const last = (named.lastName ?? "").trim();
  const recipient: Address = {
    nameFirst: first || last,
    // 只有一个名字：姓也用它（服务商两个字段都要有值，和开放 API 一样）
    nameLast: last || first,
    ...(addr.company ? { corporateName: addr.company } : {}),
    phone: (addr.phone || o.phone || o.billingAddress?.phone || "").trim() || undefined,
    ...(o.email ? { email: o.email } : {}),
    country: (addr.countryCodeV2 || "US").toUpperCase(),
    province: addr.provinceCode ?? undefined,
    city: addr.city ?? "",
    address1: addr.address1 ?? "",
    ...(addr.address2 ? { address2: addr.address2 } : {}),
    zipCode: addr.zip ?? "",
  };
  // 有地址却缺姓名或街道：订单地址不全，或 Shopify 没给客户数据
  const hidden = !!a && (!recipient.nameFirst || !recipient.address1);
  const issue = !a ? "no_address" as const : hidden ? "hidden" as const : undefined;
  return {
    extId: o.id,
    name: o.name,
    createdAt: o.createdAt,
    recipient,
    items: items.map((l) => ({
      sku: (l.sku ?? "").trim(),
      name: l.name,
      quantity: l.quantity,
      unitPrice: Number(l.originalUnitPriceSet?.shopMoney?.amount) || 0,
      currency: l.originalUnitPriceSet?.shopMoney?.currencyCode || "USD",
    })),
    weightGrams: Number(o.totalWeight) || 0,
    // 只回传给还在等发货的 fulfillment order（我们自己的仓库发货）
    fulfillRefs: o.fulfillmentOrders.nodes.filter((f) => f.status === "OPEN" || f.status === "IN_PROGRESS").map((f) => ({ id: f.id })),
    ...(issue ? { issue } : {}),
    ...(o.shippingLine?.title ? { shippingMethod: o.shippingLine.title.slice(0, 60) } : {}),
    ...(o.note?.trim() ? { note: o.note.trim().slice(0, 300) } : {}),
  };
}

/** Shopify 认识的物流商名称；认不出的照样传名称和追踪链接 */
const SHOPIFY_COMPANY: Record<string, string> = { usps: "USPS", fedex: "FedEx", ups: "UPS", dhl: "DHL Express", ontrac: "OnTrac", uniuni: "UniUni", gofo: "GOFO Express", swiftx: "SwiftX", speedx: "SpeedX", ywe: "Yanwen", spx: "SPX Express" };
export const shopifyCompany = (carrierId: string, fallback: string) => SHOPIFY_COMPANY[carrierId] ?? fallback;

/** 一次同步最多拉几页（每页 50 单） */
export const SHOPIFY_MAX_PAGES = 10;

export class ShopifyAdapter implements PlatformAdapter {
  constructor(private gql: ShopifyGraphql) {}

  async fetchOpenOrders(): Promise<FetchedOrders> {
    const orders: StoreOrder[] = [];
    let cursor: string | null = null;
    // 最多拉 10 页（500 单），够日常用；还有下一页时标记“没拉全”，没拉到的订单不能当成已关闭
    let complete = false;
    for (let page = 0; page < SHOPIFY_MAX_PAGES; page++) {
      const d = (await this.gql(ORDERS_QUERY, { cursor })) as { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlOrder[] } };
      for (const o of d.orders.nodes) {
        const n = normalizeShopifyOrder(o);
        if (n && n.fulfillRefs.length) orders.push(n);
      }
      if (!d.orders.pageInfo.hasNextPage) {
        complete = true;
        break;
      }
      cursor = d.orders.pageInfo.endCursor;
    }
    return { orders, complete };
  }

  /**
   * 导入后不在待发货列表里的订单：查一下是取消了还是已经发货了。
   * 查不到的（Shopify 返回 null：删除了，或超过 60 天、App 没有读取全部订单的权限）不返回，按“不知道”处理。
   */
  async orderStates(extIds: string[]): Promise<Record<string, StoreOrderState>> {
    const out: Record<string, StoreOrderState> = {};
    for (let i = 0; i < extIds.length; i += 50) {
      const ids = extIds.slice(i, i + 50);
      const d = (await this.gql(`query States($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id cancelledAt displayFulfillmentStatus } } }`, { ids })) as {
        nodes: ({ id?: string; cancelledAt?: string | null; displayFulfillmentStatus?: string | null } | null)[];
      };
      for (const n of d.nodes ?? []) {
        if (!n?.id) continue;
        out[n.id] = n.cancelledAt ? "cancelled" : n.displayFulfillmentStatus === "FULFILLED" || n.displayFulfillmentStatus === "RESTOCKED" ? "fulfilled" : "open";
      }
    }
    return out;
  }

  async pushFulfillment(order: StoreOrder, t: TrackingPush): Promise<string | null> {
    if (!order.fulfillRefs.length) throw new Error("Shopify 订单没有待发货的 fulfillment order（可能已在别处发货）");
    const d = (await this.gql(
      `mutation Ship($fulfillment: FulfillmentInput!) { fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id status } userErrors { field message } } }`,
      {
        fulfillment: {
          lineItemsByFulfillmentOrder: order.fulfillRefs.map((f) => ({ fulfillmentOrderId: f.id })),
          trackingInfo: { company: t.carrier, number: t.trackingNo, ...(t.trackingUrl ? { url: t.trackingUrl } : {}) },
          notifyCustomer: true,
        },
      },
    )) as { fulfillmentCreate: { fulfillment: { id: string } | null; userErrors: { message: string }[] } };
    const r = d.fulfillmentCreate;
    if (r.userErrors?.length) throw new Error(`Shopify：${r.userErrors.map((e) => e.message).join("；")}`);
    return r.fulfillment?.id ?? null;
  }

  /** Shopify 开发店铺（Dev Dashboard / Partner 建的测试店铺） */
  async isSandbox() {
    const d = (await this.gql(`query Plan { shop { plan { partnerDevelopment publicDisplayName } } }`)) as { shop: { plan: { partnerDevelopment?: boolean; publicDisplayName?: string } } };
    return !!d.shop?.plan?.partnerDevelopment || d.shop?.plan?.publicDisplayName === "Development";
  }

  async cancelFulfillment(fulfillmentId: string) {
    const d = (await this.gql(`mutation Cancel($id: ID!) { fulfillmentCancel(id: $id) { fulfillment { id status } userErrors { field message } } }`, { id: fulfillmentId })) as {
      fulfillmentCancel: { userErrors: { message: string }[] };
    };
    if (d.fulfillmentCancel.userErrors?.length) throw new Error(`Shopify：${d.fulfillmentCancel.userErrors.map((e) => e.message).join("；")}`);
  }
}

/** 演示 / 测试用：一个假的 Shopify 店铺 */
export function mockShopifyGraphql(seed = 3): ShopifyGraphql & { pushed: unknown[]; cancelled: string[]; gone: Map<string, StoreOrderState> } {
  const pushed: unknown[] = [];
  const cancelled: string[] = [];
  /** 测试用：这些订单在店铺里已经取消 / 发货（不在待发货列表里，按 ID 查是这个状态） */
  const gone = new Map<string, StoreOrderState>();
  const people = [
    ["Emily", "Johnson", "1200 Market St Apt 5", "San Francisco", "CA", "94102", "4155550101"],
    ["Michael", "Brown", "500 Congress Ave", "Austin", "TX", "78701", "5125550102"],
    ["Sarah", "Davis", "2 Elm St", "Omaha", "NE", "68104", "4025550103"],
    ["David", "Wilson", "77 Pine Rd", "Seattle", "WA", "98101", "2065550104"],
  ];
  const fn = (async (query: string, variables?: Record<string, unknown>) => {
    if (query.includes("partnerDevelopment")) return { shop: { plan: { partnerDevelopment: true, publicDisplayName: "Development" } } };
    if (query.includes("fulfillmentCreate")) {
      pushed.push(variables?.fulfillment);
      return { fulfillmentCreate: { fulfillment: { id: `gid://shopify/Fulfillment/${900 + pushed.length}`, status: "SUCCESS" }, userErrors: [] } };
    }
    if (query.includes("fulfillmentCancel")) {
      cancelled.push(String(variables?.id));
      return { fulfillmentCancel: { fulfillment: { id: variables?.id, status: "CANCELLED" }, userErrors: [] } };
    }
    if (query.includes("nodes(ids")) {
      return {
        nodes: ((variables?.ids ?? []) as string[]).map((id) => {
          const st = gone.get(id) ?? "open";
          return { id, cancelledAt: st === "cancelled" ? new Date().toISOString() : null, displayFulfillmentStatus: st === "fulfilled" ? "FULFILLED" : "UNFULFILLED" };
        }),
      };
    }
    const nodes = people.slice(0, seed).map(([f, l, a1, city, st, zip, ph], i) => ({
      id: `gid://shopify/Order/${5001 + i}`,
      name: `#${1001 + i}`,
      createdAt: new Date(Date.now() - i * 3_600_000).toISOString(),
      email: `${f.toLowerCase()}@example.com`,
      phone: null,
      totalWeight: 450 + i * 300,
      shippingLine: { title: i === 1 ? "Express" : "Standard" },
      note: i === 0 ? "Please leave at the front desk" : null,
      shippingAddress: { firstName: f, lastName: l, company: null, address1: a1, address2: null, city, provinceCode: st, zip, countryCodeV2: "US", phone: ph },
      lineItems: { nodes: [{ sku: i % 2 ? "MUG-WHITE" : "TS-BLK-M", name: i % 2 ? "Ceramic Mug" : "Cotton T-shirt - Black / M", quantity: 1 + (i % 2), requiresShipping: true, originalUnitPriceSet: { shopMoney: { amount: i % 2 ? "12.00" : "19.90", currencyCode: "USD" } } }] },
      fulfillmentOrders: { nodes: [{ id: `gid://shopify/FulfillmentOrder/${7001 + i}`, status: "OPEN" }] },
    })).filter((o) => !gone.has(o.id));
    return { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } };
  }) as ShopifyGraphql & { pushed: unknown[]; cancelled: string[]; gone: Map<string, StoreOrderState> };
  fn.pushed = pushed;
  fn.cancelled = cancelled;
  fn.gone = gone;
  return fn;
}
