/**
 * eBay 对接（我们自己注册一个 eBay 开发者 App，所有卖家共用；卖家在客户中心点“连接 eBay”授权即可）。
 * - 授权：OAuth（authorization code），访问令牌 2 小时，刷新令牌约 18 个月
 * - 订单：Sell Fulfillment API getOrders（未发货 / 部分发货）
 * - 回传：createShippingFulfillment 写入物流商和运单号
 * - 合规：eBay 要求订阅“账户删除通知”，收到后删除相关买家数据（见 /api/stores/ebay/deletion）
 */
import { createHash, createVerify } from "node:crypto";
import type { Address } from "../shipbest/types";
import type { FetchedOrders, PlatformAdapter, StoreOrder, StoreOrderState, TrackingPush } from "./types";

export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  // 读取卖家账号名（显示是哪个 eBay 店铺）
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
];

export interface EbaySettings {
  enabled: boolean;
  env: "sandbox" | "production";
  /** App ID（Client ID） */
  clientId: string;
  /** Cert ID（Client Secret） */
  clientSecret: string;
  /** RuName（eBay 开发者后台给的 Redirect URL name） */
  ruName: string;
  /** 账户删除通知的验证令牌（32–80 位，自己定，填到 eBay 后台） */
  verificationToken: string;
}

export const DEFAULT_EBAY: EbaySettings = { enabled: false, env: "sandbox", clientId: "", clientSecret: "", ruName: "", verificationToken: "" };

const host = (env: EbaySettings["env"], kind: "api" | "auth") => (env === "production" ? `https://${kind}.ebay.com` : `https://${kind}.sandbox.ebay.com`);

export function ebayAuthorizeUrl(s: EbaySettings, state: string) {
  const q = new URLSearchParams({ client_id: s.clientId, response_type: "code", redirect_uri: s.ruName, scope: EBAY_SCOPES.join(" "), state });
  return `${host(s.env, "auth")}/oauth2/authorize?${q}`;
}

export type EbayToken = { accessToken: string; expiresAt: number; refreshToken: string; refreshExpiresAt?: number | null };

async function tokenCall(s: EbaySettings, body: URLSearchParams): Promise<Record<string, any>> {
  const res = await fetch(`${host(s.env, "api")}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${s.clientId}:${s.clientSecret}`).toString("base64") },
    body,
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || !j.access_token) throw new Error(`eBay 授权失败：${j.error_description || j.error || `HTTP ${res.status}`}`);
  return j;
}

export async function exchangeEbayCode(s: EbaySettings, code: string): Promise<EbayToken> {
  const j = await tokenCall(s, new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: s.ruName }));
  return { accessToken: j.access_token, expiresAt: Date.now() + (Number(j.expires_in) || 7200) * 1000, refreshToken: j.refresh_token, refreshExpiresAt: j.refresh_token_expires_in ? Date.now() + Number(j.refresh_token_expires_in) * 1000 : null };
}

export async function refreshEbayToken(s: EbaySettings, refreshToken: string): Promise<Pick<EbayToken, "accessToken" | "expiresAt">> {
  const j = await tokenCall(s, new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, scope: EBAY_SCOPES.join(" ") }));
  return { accessToken: j.access_token, expiresAt: Date.now() + (Number(j.expires_in) || 7200) * 1000 };
}

/** 授权后查卖家账号名（失败不影响使用） */
export async function ebayUsername(s: EbaySettings, accessToken: string): Promise<string | null> {
  try {
    const base = s.env === "production" ? "https://apiz.ebay.com" : "https://apiz.sandbox.ebay.com";
    const res = await fetch(`${base}/commerce/identity/v1/user/`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as { username?: string };
    return j.username ?? null;
  } catch {
    return null;
  }
}

/**
 * 验证 eBay 通知的签名（X-EBAY-SIGNATURE 头：base64 的 JSON {alg, kid, signature, digest}）。
 * 公钥按 kid 从 eBay Notification API 取（用应用自己的 client credentials 令牌），缓存起来。
 * 签名对的返回 true；头缺失 / 格式不对 / 验不过返回 false；取公钥失败抛错（让 eBay 稍后重试）。
 */
const keyCache = new Map<string, { pem: string; at: number }>();
let appToken: { token: string; exp: number } | null = null;

async function ebayAppToken(s: EbaySettings): Promise<string> {
  if (appToken && appToken.exp > Date.now() + 60_000) return appToken.token;
  const j = await tokenCall(s, new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }));
  appToken = { token: j.access_token, exp: Date.now() + Number(j.expires_in ?? 7200) * 1000 };
  return appToken.token;
}

export async function verifyEbayNotification(s: EbaySettings, signatureHeader: string | null, rawBody: string, fetchKey?: (kid: string) => Promise<string>): Promise<boolean> {
  if (!signatureHeader) return false;
  let sig: { alg?: string; kid?: string; signature?: string; digest?: string };
  try {
    sig = JSON.parse(Buffer.from(signatureHeader, "base64").toString("utf8"));
  } catch {
    return false;
  }
  if (!sig.kid || !sig.signature || !/^[\w-]{1,100}$/.test(sig.kid)) return false;
  let pem = keyCache.get(sig.kid)?.pem;
  if (!pem) {
    pem = fetchKey
      ? await fetchKey(sig.kid)
      : await (async () => {
          const res = await fetch(`${host(s.env, "api")}/commerce/notification/v1/public_key/${sig.kid}`, {
            headers: { Authorization: `Bearer ${await ebayAppToken(s)}` },
            signal: AbortSignal.timeout(20_000),
            cache: "no-store",
          });
          const j = (await res.json().catch(() => ({}))) as { key?: string };
          if (!res.ok || !j.key) throw new Error(`取 eBay 公钥失败：HTTP ${res.status}`);
          return j.key;
        })();
    keyCache.set(sig.kid, { pem, at: Date.now() });
  }
  // eBay 返回的公钥有时没有换行：整理成标准 PEM
  const body64 = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  const keyPem = `-----BEGIN PUBLIC KEY-----\n${body64.match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----\n`;
  try {
    const algo = (sig.digest ?? "SHA1").toUpperCase() === "SHA256" ? "sha256" : "sha1";
    return createVerify(algo).update(rawBody).verify(keyPem, Buffer.from(sig.signature, "base64"));
  } catch {
    return false;
  }
}

/** 账户删除通知的验证：challengeResponse = sha256(challengeCode + verificationToken + endpoint) */
export function ebayChallengeResponse(challengeCode: string, verificationToken: string, endpoint: string) {
  return createHash("sha256").update(challengeCode).update(verificationToken).update(endpoint).digest("hex");
}

/** 发 REST 请求的函数（测试 / 演示可以换成假的） */
export type EbayRest = (method: "GET" | "POST", path: string, body?: unknown) => Promise<{ status: number; json: any; location?: string | null }>;

export function ebayHttp(s: EbaySettings, getToken: () => Promise<string>): EbayRest {
  return async (method, path, body) => {
    const res = await fetch(`${host(s.env, "api")}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json", Accept: "application/json", "Content-Language": "en-US" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    return { status: res.status, json, location: res.headers.get("location") };
  };
}

function ebayError(r: { status: number; json: any }) {
  const errs = (r.json?.errors ?? []) as { message?: string; longMessage?: string }[];
  return new Error(`eBay：${errs.map((e) => e.longMessage || e.message).filter(Boolean).join("；") || `HTTP ${r.status}`}`);
}

type EbayOrder = {
  orderId: string;
  creationDate: string;
  orderFulfillmentStatus?: string;
  cancelStatus?: { cancelState?: string };
  orderPaymentStatus?: string;
  buyer?: { username?: string };
  buyerCheckoutNotes?: string;
  fulfillmentStartInstructions?: { shippingStep?: { shippingServiceCode?: string; shipTo?: { fullName?: string; companyName?: string; contactAddress?: { addressLine1?: string; addressLine2?: string; city?: string; stateOrProvince?: string; postalCode?: string; countryCode?: string }; primaryPhone?: { phoneNumber?: string }; email?: string } } }[];
  lineItems?: { lineItemId: string; sku?: string; title?: string; quantity?: number; lineItemCost?: { value?: string; currency?: string }; lineItemFulfillmentStatus?: string }[];
};

export function normalizeEbayOrder(o: EbayOrder): (StoreOrder & { buyer?: string }) | null {
  const to = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
  const a = to?.contactAddress;
  const items = (o.lineItems ?? []).filter((l) => l.lineItemFulfillmentStatus !== "FULFILLED" && (l.quantity ?? 0) > 0);
  if (!to || !a || !items.length) return null;
  // 只发已付款的（没付款 / 付款失败的不同步）
  if (o.orderPaymentStatus && !["PAID", "PARTIALLY_REFUNDED"].includes(o.orderPaymentStatus)) return null;
  const parts = (to.fullName ?? "").trim().split(/\s+/);
  const recipient: Address = {
    nameFirst: parts[0] ?? "",
    // 只有一个名字：姓也用它（服务商两个字段都要有值，和开放 API 一样）
    nameLast: parts.slice(1).join(" ") || (parts[0] ?? ""),
    ...(to.companyName ? { corporateName: to.companyName } : {}),
    phone: to.primaryPhone?.phoneNumber || undefined,
    ...(to.email ? { email: to.email } : {}),
    country: (a.countryCode || "US").toUpperCase(),
    province: a.stateOrProvince ?? undefined,
    city: a.city ?? "",
    address1: a.addressLine1 ?? "",
    ...(a.addressLine2 ? { address2: a.addressLine2 } : {}),
    zipCode: a.postalCode ?? "",
  };
  return {
    extId: o.orderId,
    name: o.orderId,
    createdAt: o.creationDate,
    recipient,
    items: items.map((l) => {
      const qty = l.quantity ?? 1;
      return { sku: (l.sku ?? "").trim(), name: l.title ?? "", quantity: qty, unitPrice: Math.round(((Number(l.lineItemCost?.value) || 0) / qty) * 100) / 100, currency: l.lineItemCost?.currency || "USD" };
    }),
    weightGrams: 0,
    fulfillRefs: items.map((l) => ({ id: l.lineItemId, quantity: l.quantity ?? 1 })),
    ...(o.buyer?.username ? { buyer: o.buyer.username } : {}),
    ...(o.fulfillmentStartInstructions?.[0]?.shippingStep?.shippingServiceCode ? { shippingMethod: o.fulfillmentStartInstructions[0].shippingStep.shippingServiceCode.slice(0, 60) } : {}),
    ...(o.buyerCheckoutNotes?.trim() ? { note: o.buyerCheckoutNotes.trim().slice(0, 300) } : {}),
  };
}

/** 一次同步最多拉几页（每页 100 单） */
export const EBAY_MAX_PAGES = 5;

/** eBay 的物流商代码；认不出的用 Other */
const EBAY_CARRIER: Record<string, string> = { usps: "USPS", fedex: "FedEx", ups: "UPS", dhl: "DHL", ontrac: "OnTrac" };
export const ebayCarrier = (carrierId: string) => EBAY_CARRIER[carrierId] ?? "Other";

export class EbayAdapter implements PlatformAdapter {
  /** sandbox：连的是 eBay 沙盒（测试环境） */
  constructor(private rest: EbayRest, private sandbox = false) {}

  async isSandbox() {
    return this.sandbox;
  }

  async fetchOpenOrders(): Promise<FetchedOrders> {
    const orders: StoreOrder[] = [];
    const closedExtIds: string[] = [];
    let path: string | null = `/sell/fulfillment/v1/order?filter=${encodeURIComponent("orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}")}&limit=100`;
    // 最多拉 5 页（500 单）；还有下一页时标记“没拉全”，没拉到的订单不能当成已关闭
    for (let page = 0; path && page < EBAY_MAX_PAGES; page++) {
      const r = await this.rest("GET", path);
      if (r.status >= 300) throw ebayError(r);
      for (const o of (r.json.orders ?? []) as EbayOrder[]) {
        if (o.cancelStatus?.cancelState === "CANCELED") {
          closedExtIds.push(o.orderId);
          continue;
        }
        const n = normalizeEbayOrder(o);
        if (n) orders.push(n);
      }
      const next = r.json.next as string | undefined;
      path = next ? next.replace(/^https?:\/\/[^/]+/, "") : null;
    }
    return { orders, closedExtIds, complete: !path };
  }

  /** 导入后不在待发货列表里的订单：按订单号查现在的状态（一次最多 50 个；查不到的不返回） */
  async orderStates(extIds: string[]): Promise<Record<string, StoreOrderState>> {
    const out: Record<string, StoreOrderState> = {};
    for (let i = 0; i < extIds.length; i += 50) {
      const r = await this.rest("GET", `/sell/fulfillment/v1/order?orderIds=${encodeURIComponent(extIds.slice(i, i + 50).join(","))}`);
      if (r.status >= 300) throw ebayError(r);
      for (const o of (r.json.orders ?? []) as EbayOrder[]) {
        out[o.orderId] = o.cancelStatus?.cancelState === "CANCELED" ? "cancelled" : o.orderFulfillmentStatus === "FULFILLED" ? "fulfilled" : "open";
      }
    }
    return out;
  }

  async pushFulfillment(order: StoreOrder, t: TrackingPush): Promise<string | null> {
    const body = {
      lineItems: order.fulfillRefs.map((f) => ({ lineItemId: f.id, quantity: f.quantity ?? 1 })),
      shippedDate: new Date().toISOString(),
      shippingCarrierCode: t.carrier,
      trackingNumber: t.trackingNo,
    };
    const path = `/sell/fulfillment/v1/order/${encodeURIComponent(order.extId)}/shipping_fulfillment`;
    let r = await this.rest("POST", path, body);
    // 物流商代码 eBay 不认：改成 Other 再传一次
    if (r.status >= 300 && t.carrier !== "Other" && JSON.stringify(r.json).match(/carrier/i)) r = await this.rest("POST", path, { ...body, shippingCarrierCode: "Other" });
    if (r.status >= 300) throw ebayError(r);
    return r.location?.split("/").pop() ?? null;
  }

  async cancelFulfillment(): Promise<void> {
    throw new Error("eBay 不支持撤回已上传的运单号：请在 eBay 订单里手动更新，或重新出单后系统会再上传新运单号");
  }
}

/** 演示 / 测试用：一个假的 eBay 卖家 */
export function mockEbayRest(): EbayRest & { pushed: unknown[]; cancelled: Set<string> } {
  const pushed: unknown[] = [];
  /** 测试用：买家取消了的订单（列表里带 cancelState = CANCELED） */
  const cancelled = new Set<string>();
  const fn = (async (method: string, path: string, body?: unknown) => {
    if (method === "POST" && path.includes("/shipping_fulfillment")) {
      pushed.push(body);
      return { status: 201, json: {}, location: `https://api.ebay.com${path}/${pushed.length}0000` };
    }
    const orders: EbayOrder[] = [
      {
        orderId: "12-13456-78901",
        creationDate: new Date().toISOString(),
        orderFulfillmentStatus: "NOT_STARTED",
        buyer: { username: "buyer_jane" },
        fulfillmentStartInstructions: [{ shippingStep: { shippingServiceCode: "USPSPriority", shipTo: { fullName: "Jane Miller", contactAddress: { addressLine1: "45 Oak Ave", city: "Denver", stateOrProvince: "CO", postalCode: "80202", countryCode: "US" }, primaryPhone: { phoneNumber: "3035550111" } } } }],
        lineItems: [{ lineItemId: "10001", sku: "CASE-IP15", title: "iPhone 15 Case Clear", quantity: 2, lineItemCost: { value: "17.98", currency: "USD" }, lineItemFulfillmentStatus: "NOT_STARTED" }],
      },
    ];
    for (const o of orders) if (cancelled.has(o.orderId)) o.cancelStatus = { cancelState: "CANCELED" };
    return { status: 200, json: { orders, total: orders.length } };
  }) as EbayRest & { pushed: unknown[]; cancelled: Set<string> };
  fn.pushed = pushed;
  fn.cancelled = cancelled;
  return fn;
}
