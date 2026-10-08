/**
 * 电商店铺对接（Shopify / eBay）：
 * 1. 店铺连接：保存授权（令牌只在服务器上，页面不显示）
 * 2. 同步未发货订单到本地（店铺订单列表）
 * 3. 客户勾选订单 → 生成批量下单批次（复用批量下单：试算、选渠道、提交、打印）
 * 4. 出单后自动把运单号回传到店铺（后台每分钟检查一次）；取消面单时撤回 Shopify 的发货
 */
import { randomBytes } from "node:crypto";
import { activeShipmentByRef, db, getSettings, getShipment } from "../db";
import { createJob, flagStoreRow, INTL_IMPORT_MSG, normalizeUsZip, senderFor, type ParsedOrder } from "../batch";
import { getSender } from "../senders";
import type { Address } from "../shipbest/types";
import { validateRequest } from "../service";
import { displayChannel } from "../channelDisplay";
import { trackingUrl } from "../carriers";
import { isMockMode } from "../shipbest/client";
import { isInternational } from "../shipbest/dhl";
import type { ShipmentRequest, SkuItem, UnitSystem } from "../shipbest/types";
import { DEFAULT_EBAY, EbayAdapter, ebayCarrier, ebayHttp, mockEbayRest, refreshEbayToken, type EbaySettings, type EbayToken } from "./ebay";
import { mockShopifyGraphql, normalizeShop, refreshShopifyToken, SHOPIFY_RECONNECT, shopifyCompany, ShopifyAdapter, ShopifyAuthError, shopifyHttp, type ShopifyToken } from "./shopify";
import { StoreAuthError, type Platform, type PlatformAdapter, type StoreOrder, type StoreOrderState, type TrackingPush } from "./types";

export * from "./types";

/* ---------------- 表 ---------------- */

let ready: unknown = null;
function conn() {
  const c = db();
  if (ready !== c) {
    c.exec(`CREATE TABLE IF NOT EXISTS store_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      shop TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      config_json TEXT,
      token_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      oauth_state TEXT,
      last_sync_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS store_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      ext_id TEXT NOT NULL,
      name TEXT NOT NULL,
      ordered_at TEXT,
      data_json TEXT NOT NULL,
      buyer TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      job_id INTEGER,
      row_no INTEGER,
      shipment_id INTEGER,
      fulfillment_id TEXT,
      pushed_at TEXT,
      push_error TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (store_id, ext_id)
    );
    CREATE INDEX IF NOT EXISTS store_orders_status ON store_orders (status);
    CREATE TABLE IF NOT EXISTS store_access (
      customer_id INTEGER PRIMARY KEY,
      enabled_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`);
    // 后加的列：没有回传到店铺的原因（例如模拟面单不回传到正式店铺）
    const cols = (c.prepare("PRAGMA table_info(store_orders)").all() as { name: string }[]).map((x) => x.name);
    if (!cols.includes("push_note")) c.exec("ALTER TABLE store_orders ADD COLUMN push_note TEXT");
    // 回传失败了几次（超过上限就不再自动重试，页面上提示手动处理）
    if (!cols.includes("push_attempts")) c.exec("ALTER TABLE store_orders ADD COLUMN push_attempts INTEGER NOT NULL DEFAULT 0");
    ready = c;
  }
  return c;
}

/* ---------------- 开放范围（测试阶段：后台逐个客户开放） ---------------- */

/** 这个客户能不能用店铺对接（默认不开放，后台在客户详情里开放） */
export function storesEnabled(customerId: number): boolean {
  return !!conn().prepare("SELECT 1 FROM store_access WHERE customer_id = ?").get(customerId);
}

export function setStoresEnabled(customerId: number, on: boolean) {
  if (on) conn().prepare("INSERT OR IGNORE INTO store_access (customer_id) VALUES (?)").run(customerId);
  else conn().prepare("DELETE FROM store_access WHERE customer_id = ?").run(customerId);
}

/* ---------------- 店铺连接 ---------------- */

export type StoreStatus = "pending" | "connected" | "error" | "disconnected";

export interface StoreConnection {
  id: number;
  customerId: number;
  platform: Platform;
  /** Shopify：xxx.myshopify.com；eBay：卖家账号（授权后才有） */
  shop: string;
  name: string;
  status: StoreStatus;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  /** Shopify 自定义 App 的 Client ID（Secret 不返回） */
  clientId: string | null;
  hasSecret: boolean;
  /** Shopify 自定义分发的安装链接（我们替客户建 App 时填，客户点一下就装好） */
  installUrl: string | null;
  openCount: number;
}

interface StoreRow {
  id: number; customer_id: number; platform: Platform; shop: string; name: string; config_json: string | null; token_json: string | null;
  status: StoreStatus; oauth_state: string | null; last_sync_at: string | null; last_error: string | null; created_at: string;
}

function toStore(r: StoreRow): StoreConnection {
  const cfg = r.config_json ? (JSON.parse(r.config_json) as { clientId?: string; clientSecret?: string; installUrl?: string }) : {};
  const open = (conn().prepare("SELECT COUNT(*) AS n FROM store_orders WHERE store_id = ? AND status = 'open'").get(r.id) as { n: number }).n;
  return {
    id: r.id, customerId: r.customer_id, platform: r.platform, shop: r.shop, name: r.name || r.shop, status: r.status,
    lastSyncAt: r.last_sync_at, lastError: r.last_error, createdAt: r.created_at, clientId: cfg.clientId ?? null, hasSecret: !!cfg.clientSecret, installUrl: cfg.installUrl ?? null, openCount: open,
  };
}

const row = (id: number) => conn().prepare("SELECT * FROM store_connections WHERE id = ?").get(id) as StoreRow | undefined;

export function listStores(customerId?: number): StoreConnection[] {
  const rows = (customerId
    ? conn().prepare("SELECT * FROM store_connections WHERE customer_id = ? ORDER BY id").all(customerId)
    : conn().prepare("SELECT * FROM store_connections ORDER BY id").all()) as StoreRow[];
  return rows.map(toStore);
}

export function getStore(id: number): StoreConnection | null {
  const r = row(id);
  return r ? toStore(r) : null;
}

export function ebaySettings(): EbaySettings {
  return { ...DEFAULT_EBAY, ...(getSettings().ebay ?? {}) };
}

/** 演示店铺（模拟模式下不连真实平台） */
export const DEMO_SHOPIFY = "atr-demo.myshopify.com";
export const DEMO_EBAY = "demo-ebay-seller";
const isDemo = (r: Pick<StoreRow, "platform" | "shop">) => isMockMode() && (r.shop === DEMO_SHOPIFY || r.shop === DEMO_EBAY);

/** 后台添加 / 修改 Shopify 店铺（每个店铺在 Dev Dashboard 建一个自定义 App，Client ID / Secret 填这里） */
/** 安装链接只接受 Shopify 自己的网址（防止填成钓鱼链接发给客户） */
export function normalizeInstallUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol === "https:" && (u.hostname === "shopify.com" || u.hostname.endsWith(".shopify.com") || u.hostname.endsWith(".myshopify.com"))) return u.toString();
  } catch {
    // 不是网址
  }
  throw new Error("安装链接不对：应为 Shopify 生成的 https://…shopify.com/… 链接");
}

export function saveShopifyStore(input: { id?: number | null; customerId: number; shop: string; clientId: string; clientSecret?: string; installUrl?: string | null }): number {
  const shop = normalizeShop(input.shop);
  if (!shop) throw new Error("店铺域名不对，应为 xxx.myshopify.com");
  const dup = conn().prepare("SELECT id FROM store_connections WHERE platform = 'shopify' AND shop = ? AND id != ?").get(shop, input.id ?? 0) as { id: number } | undefined;
  if (dup) throw new Error("这个 Shopify 店铺已经连接过了");
  const cur = input.id ? row(input.id) : undefined;
  if (input.id && (!cur || cur.customer_id !== input.customerId)) throw new Error("店铺不存在");
  const old = cur?.config_json ? JSON.parse(cur.config_json) : {};
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret?.trim() || old.clientSecret || "";
  if (shop !== DEMO_SHOPIFY && (!clientId || !clientSecret)) throw new Error("请填写 Shopify App 的 Client ID 和 Client Secret");
  // installUrl 没传 = 不修改；传空字符串 = 清掉
  const installUrl = input.installUrl === undefined ? old.installUrl ?? null : normalizeInstallUrl(input.installUrl);
  const cfg = JSON.stringify({ clientId, clientSecret, ...(installUrl ? { installUrl } : {}) });
  if (cur) {
    // 换了 App 或店铺：原来的授权作废，要重新连接
    const changed = cur.shop !== shop || old.clientId !== clientId;
    conn().prepare(`UPDATE store_connections SET shop = ?, name = ?, config_json = ?${changed ? ", token_json = NULL, status = 'pending'" : ""} WHERE id = ?`).run(shop, shop.replace(".myshopify.com", ""), cfg, cur.id);
    return cur.id;
  }
  const demo = shop === DEMO_SHOPIFY && isMockMode();
  return Number(
    conn()
      .prepare("INSERT INTO store_connections (customer_id, platform, shop, name, config_json, status) VALUES (?, 'shopify', ?, ?, ?, ?)")
      .run(input.customerId, shop, shop.replace(".myshopify.com", ""), cfg, demo ? "connected" : "pending").lastInsertRowid,
  );
}

/** eBay：客户点“连接 eBay”时先建一条待授权的连接（授权回来再补上卖家账号） */
export function startEbayConnection(customerId: number): { id: number; state: string } {
  const state = randomBytes(16).toString("hex");
  // 上次没授权完的那条接着用，不然客户每点一次就多一行“待授权”
  const left = conn().prepare("SELECT id FROM store_connections WHERE customer_id = ? AND platform = 'ebay' AND status = 'pending' AND shop = '' ORDER BY id DESC").get(customerId) as { id: number } | undefined;
  if (left) {
    conn().prepare("UPDATE store_connections SET oauth_state = ? WHERE id = ?").run(state, left.id);
    return { id: left.id, state };
  }
  const id = Number(conn().prepare("INSERT INTO store_connections (customer_id, platform, name, status, oauth_state) VALUES (?, 'ebay', 'eBay', 'pending', ?)").run(customerId, state).lastInsertRowid);
  return { id, state };
}

/** 演示：直接加一个模拟 eBay 店铺 */
export function addDemoEbay(customerId: number) {
  const had = conn().prepare("SELECT id FROM store_connections WHERE customer_id = ? AND platform = 'ebay' AND shop = ?").get(customerId, DEMO_EBAY) as { id: number } | undefined;
  if (had) {
    conn().prepare("UPDATE store_connections SET status = 'connected', last_error = NULL WHERE id = ?").run(had.id);
    return had.id;
  }
  return Number(conn().prepare("INSERT INTO store_connections (customer_id, platform, shop, name, status) VALUES (?, 'ebay', ?, 'eBay (Demo)', 'connected')").run(customerId, DEMO_EBAY).lastInsertRowid);
}

export function newShopifyState(id: number): string {
  const state = randomBytes(16).toString("hex");
  conn().prepare("UPDATE store_connections SET oauth_state = ? WHERE id = ?").run(state, id);
  return state;
}

export function findStoreByState(state: string): StoreRow | undefined {
  if (!state || state.length < 16) return undefined;
  return conn().prepare("SELECT * FROM store_connections WHERE oauth_state = ?").get(state) as StoreRow | undefined;
}

export function findShopifyStore(shop: string): StoreRow | undefined {
  return conn().prepare("SELECT * FROM store_connections WHERE platform = 'shopify' AND shop = ?").get(shop) as StoreRow | undefined;
}

export function shopifySecrets(id: number): { clientId: string; clientSecret: string } | null {
  const r = row(id);
  if (!r?.config_json) return null;
  const c = JSON.parse(r.config_json) as { clientId?: string; clientSecret?: string };
  return c.clientId && c.clientSecret ? { clientId: c.clientId, clientSecret: c.clientSecret } : null;
}

/** 授权成功：保存令牌（只存在服务器数据库里） */
export function saveStoreToken(id: number, token: ShopifyToken | EbayToken, extra: { shop?: string; name?: string } = {}) {
  const sets = ["token_json = @token", "status = 'connected'", "oauth_state = NULL", "last_error = NULL"];
  if (extra.shop) sets.push("shop = @shop");
  if (extra.name) sets.push("name = @name");
  conn().prepare(`UPDATE store_connections SET ${sets.join(", ")} WHERE id = @id`).run({ token: JSON.stringify(token), id, shop: extra.shop ?? null, name: extra.name ?? null });
  // 重新授权后：之前回传失败太多次停下来的订单再给几次机会（多半就是授权的问题）
  conn().prepare("UPDATE store_orders SET push_attempts = 0, push_note = NULL WHERE store_id = ? AND push_note = ?").run(id, PUSH_GAVE_UP_NOTE);
}

/**
 * eBay 授权成功：同一个卖家账号以前连过（断开后重新连接）就沿用原来那条，订单记录不丢；
 * 已经连在别的客户名下则拒绝。返回最终的店铺 ID。
 */
export function finishEbayConnection(id: number, token: EbayToken, user: string | null): number {
  const cur = row(id);
  if (!cur) throw new Error("店铺不存在");
  if (user) {
    const old = conn().prepare("SELECT * FROM store_connections WHERE platform = 'ebay' AND shop = ? AND id != ?").get(user, id) as StoreRow | undefined;
    if (old && old.customer_id !== cur.customer_id) {
      deleteStore(id);
      throw new Error(`eBay 账号 ${user} 已经连接在其他客户名下，请联系客服`);
    }
    if (old) {
      deleteStore(id);
      saveStoreToken(old.id, token, { name: `eBay · ${user}` });
      return old.id;
    }
  }
  saveStoreToken(id, token, user ? { shop: user, name: `eBay · ${user}` } : {});
  return id;
}

export function disconnectStore(id: number, customerId?: number) {
  const r = row(id);
  if (!r || (customerId && r.customer_id !== customerId)) throw new Error("店铺不存在");
  conn().prepare("UPDATE store_connections SET token_json = NULL, status = 'disconnected' WHERE id = ?").run(id);
}

/** 客户删除自己的店铺连接（只能删没在用的：待授权 / 已断开） */
export function deleteMyStore(id: number, customerId: number) {
  const r = row(id);
  if (!r || r.customer_id !== customerId) throw new Error("店铺不存在");
  if (r.status === "connected") throw new Error("请先断开连接再删除");
  deleteStore(id);
}

export function deleteStore(id: number) {
  conn().prepare("DELETE FROM store_orders WHERE store_id = ?").run(id);
  conn().prepare("DELETE FROM store_connections WHERE id = ?").run(id);
}

/* ---------------- 平台接口 ---------------- */

const g = globalThis as unknown as { __storeMocks?: Map<number, PlatformAdapter & { mock: unknown }> };
const mocks = (g.__storeMocks ??= new Map());

/** 测试用：拿到模拟店铺（看回传了什么） */
export function mockOf(id: number) {
  return mocks.get(id)?.mock as (ReturnType<typeof mockShopifyGraphql> | ReturnType<typeof mockEbayRest>) | undefined;
}

export function adapterFor(id: number): PlatformAdapter {
  const r = row(id);
  if (!r) throw new Error("店铺不存在");
  if (isDemo(r)) {
    let m = mocks.get(id);
    if (!m) {
      const mock = r.platform === "shopify" ? mockShopifyGraphql() : mockEbayRest();
      const a = r.platform === "shopify" ? new ShopifyAdapter(mock as ReturnType<typeof mockShopifyGraphql>) : new EbayAdapter(mock as ReturnType<typeof mockEbayRest>, true);
      m = Object.assign(a, { mock });
      mocks.set(id, m);
    }
    return m;
  }
  if (r.status !== "connected" || !r.token_json) throw new Error("店铺还没有授权连接");
  const token = JSON.parse(r.token_json) as ShopifyToken & EbayToken;
  if (r.platform === "shopify") {
    let sp: ShopifyToken = token;
    return new ShopifyAdapter(
      shopifyHttp(r.shop, async () => {
        // 会过期的令牌：提前 5 分钟用刷新令牌换新的；没有刷新令牌 / 刷新被拒绝时标记“要重新连接”
        if (sp.expiresAt && Date.now() > sp.expiresAt - 300_000) sp = await renewShopifyToken(id, r.shop, sp);
        return sp.accessToken;
      }),
    );
  }
  const s = ebaySettings();
  if (!s.enabled || !s.clientId) throw new Error("eBay 对接还没有在后台设置里启用");
  let cur = token;
  return new EbayAdapter(
    ebayHttp(s, async () => {
      // 刷新令牌（约 18 个月）也过期了：只能重新授权
      if (cur.refreshExpiresAt && Date.now() > cur.refreshExpiresAt) {
        needsReconnect(id, EBAY_RECONNECT);
        throw new StoreAuthError(EBAY_RECONNECT);
      }
      // 访问令牌 2 小时过期：提前 5 分钟用刷新令牌换新的
      if (cur.expiresAt && Date.now() > cur.expiresAt - 300_000) {
        const n = await refreshEbayToken(s, cur.refreshToken);
        cur = { ...cur, ...n };
        conn().prepare("UPDATE store_connections SET token_json = ? WHERE id = ?").run(JSON.stringify(cur), id);
      }
      return cur.accessToken;
    }),
    s.env === "sandbox",
  );
}

/** 授权不能用了：店铺标成“连接出错”，卡片上显示原因和“重新授权”按钮，自动同步先停下（不再每 15 分钟报一次错） */
function needsReconnect(id: number, message: string) {
  conn().prepare("UPDATE store_connections SET status = 'error', last_error = ? WHERE id = ? AND status = 'connected'").run(message.slice(0, 300), id);
}

export const EBAY_RECONNECT = "eBay 授权已过期，请重新连接 eBay 店铺";

const gr = globalThis as unknown as { __shopifyRefresh?: Map<number, Promise<ShopifyToken>> };
const refreshing = (gr.__shopifyRefresh ??= new Map());

/**
 * Shopify 令牌快过期：用刷新令牌换新的并保存。同一个店铺同时只换一次（刷新令牌可能只能用一次），
 * 别的请求刚换过就直接用数据库里新的。
 */
function renewShopifyToken(id: number, shop: string, cur: ShopifyToken): Promise<ShopifyToken> {
  const running = refreshing.get(id);
  if (running) return running;
  const p = (async () => {
    const saved = row(id)?.token_json;
    const latest = saved ? (JSON.parse(saved) as ShopifyToken) : cur;
    if (latest.expiresAt && Date.now() < latest.expiresAt - 300_000) return latest;
    const sec = shopifySecrets(id);
    try {
      if (!latest.refreshToken || !sec || (latest.refreshExpiresAt && Date.now() > latest.refreshExpiresAt)) throw new ShopifyAuthError(SHOPIFY_RECONNECT);
      const next = await refreshShopifyToken(shop, sec.clientId, sec.clientSecret, latest.refreshToken);
      conn().prepare("UPDATE store_connections SET token_json = ? WHERE id = ?").run(JSON.stringify(next), id);
      return next;
    } catch (e) {
      if (e instanceof ShopifyAuthError) needsReconnect(id, e.message);
      throw e;
    }
  })().finally(() => refreshing.delete(id));
  refreshing.set(id, p);
  return p;
}

/* ---------------- 订单同步 ---------------- */

export type StoreOrderStatus = "open" | "imported" | "shipped" | "closed";

export interface StoreOrderRow {
  id: number;
  storeId: number;
  platform: Platform;
  storeName: string;
  extId: string;
  name: string;
  orderedAt: string | null;
  order: StoreOrder;
  status: StoreOrderStatus;
  jobId: number | null;
  shipmentId: number | null;
  trackingNo: string | null;
  /** 面单状态（pending / labeled / cancelled…） */
  shipmentStatus: string | null;
  pushedAt: string | null;
  pushError: string | null;
  /** 没回传的原因（模拟面单不回传到正式店铺） */
  pushNote: string | null;
}

/** 从店铺拉未发货订单：新的加进来；已导入 / 已发货的不动；店铺里已经不用发的（取消、别处发货）标记关闭 */
export const HIDDEN_HINT = "有订单没有收件人姓名 / 街道地址：先在 Shopify 后台打开这些订单看收货地址是否完整，补全后点“立即同步订单”。如果店铺里的地址是完整的，说明我们没拿到客户数据，请联系客服";

/** 导入后店铺里已经不用发货了（还没出面单）：订单关闭时显示的原因 */
export const STORE_NOTE: Record<StoreOrderState | "gone", string> = {
  cancelled: "店铺里已取消这单，不用再发货",
  fulfilled: "店铺里这单已经发货（在别处发货），不用再发货",
  gone: "店铺里这单已经不在待发货列表里（可能已取消或已在别处发货）",
  open: "",
};
/**
 * 已经出了面单，店铺里却取消了 / 已经是已发货：运单号不再回传。
 * “已发货”也可能是我们回传时网络超时、其实店铺已经收到了，所以只提醒客户去核对，不直接说面单没用。
 */
export const STORE_NOTE_LABELED: Record<StoreOrderState | "gone", string> = {
  cancelled: "店铺里已取消这单，运单号没有回传到店铺。面单如果不用了，请尽快取消",
  fulfilled: "店铺里这单已经是已发货状态，系统没有再回传运单号。请到店铺后台核对：如果不是用这张面单发的，面单不用了请尽快取消",
  gone: "店铺里这单已经不在待发货列表里，系统没有再回传运单号。请到店铺后台核对：如果已取消或不是用这张面单发的，面单不用了请尽快取消",
  open: "",
};
/** 回传失败次数太多：不再自动重试 */
export const PUSH_GAVE_UP_NOTE = "回传店铺失败次数太多，已停止自动重试：请在店铺后台手动填写运单号";
export const MAX_PUSH_ATTEMPTS = 5;

/** 一次同步最多查多少个“导入后不见了”的订单的状态 */
const MAX_STATE_CHECKS = 200;

/** 店铺订单关掉（店铺里已经不用发货）：批次里还没下单的那一行取消勾选并提醒，不再回传 */
function closeStoreOrder(o: { id: number; job_id: number | null; row_no: number | null }, note: string, pushError: string | null = null) {
  conn().prepare("UPDATE store_orders SET status = 'closed', push_note = ?, push_error = ?, updated_at = datetime('now') WHERE id = ?").run(note, pushError, o.id);
  if (o.job_id && o.row_no) flagStoreRow(o.job_id, o.row_no, true);
}

/** 这个店铺订单在批次里有没有出了面单（没取消的） */
function hasActiveLabel(o: { job_id: number | null; row_no: number | null }) {
  if (!o.job_id || !o.row_no) return false;
  const r = conn().prepare("SELECT shipment_id FROM batch_job_rows WHERE job_id = ? AND row_no = ?").get(o.job_id, o.row_no) as { shipment_id: number | null } | undefined;
  const s = r?.shipment_id ? getShipment(r.shipment_id) : null;
  return !!s && s.status !== "cancelled";
}

export async function syncStore(id: number): Promise<{ added: number; total: number; closed: number }> {
  const r = row(id);
  if (!r) throw new Error("店铺不存在");
  try {
    const adapter = adapterFor(id);
    // complete = false：订单太多只拉了最新的几页，没拉到的不能当成“店铺里已经不用发货”
    const { orders, closedExtIds = [], complete = true } = await adapter.fetchOpenOrders();
    const c = conn();
    let added = 0;
    let closed = 0;
    const seen = new Set(orders.map((o) => o.extId));
    const cancelledIds = new Set(closedExtIds);
    // 已导入、还没回传的订单不在待发货列表里了：问一下店铺是取消了还是已经发货了（暂停发货等还要发的不动）
    type Imported = { id: number; ext_id: string; job_id: number | null; row_no: number | null };
    const imported = c.prepare("SELECT id, ext_id, job_id, row_no FROM store_orders WHERE store_id = ? AND status = 'imported' ORDER BY updated_at").all(id) as Imported[];
    const ask = imported.filter((o) => !seen.has(o.ext_id) && !cancelledIds.has(o.ext_id)).map((o) => o.ext_id).slice(0, MAX_STATE_CHECKS);
    let states: Record<string, StoreOrderState> | null = null;
    if (ask.length && adapter.orderStates) states = await adapter.orderStates(ask).catch(() => null);
    c.transaction(() => {
      for (const o of orders) {
        const buyer = (o as StoreOrder & { buyer?: string }).buyer ?? null;
        const ex = c.prepare("SELECT id, status, job_id, row_no FROM store_orders WHERE store_id = ? AND ext_id = ?").get(id, o.extId) as
          | { id: number; status: StoreOrderStatus; job_id: number | null; row_no: number | null }
          | undefined;
        if (!ex) {
          c.prepare("INSERT INTO store_orders (store_id, ext_id, name, ordered_at, data_json, buyer) VALUES (?,?,?,?,?,?)").run(id, o.extId, o.name, o.createdAt, JSON.stringify(o), buyer);
          added++;
        } else if (ex.status === "closed" && ex.job_id) {
          // 导入后在店铺里关掉了、现在又回到待发货：恢复成“已导入”，批次里的提醒去掉（不替客户重新勾选）
          c.prepare("UPDATE store_orders SET data_json = ?, status = 'imported', push_note = NULL, push_error = NULL, push_attempts = 0, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(o), ex.id);
          if (ex.row_no) flagStoreRow(ex.job_id, ex.row_no, false);
        } else if (ex.status === "open" || ex.status === "closed") {
          // 还没导入的：用最新内容（地址可能改过）；之前关掉的又出现了就重新打开
          c.prepare("UPDATE store_orders SET data_json = ?, status = 'open', updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(o), ex.id);
        }
      }
      // 本地还是“待处理”、但店铺已经不在未发货列表里的：关闭（只拉了一部分时，没拉到的不动）
      for (const o of c.prepare("SELECT id, ext_id FROM store_orders WHERE store_id = ? AND status = 'open'").all(id) as { id: number; ext_id: string }[]) {
        if (cancelledIds.has(o.ext_id) || (complete && !seen.has(o.ext_id))) {
          c.prepare("UPDATE store_orders SET status = 'closed', updated_at = datetime('now') WHERE id = ?").run(o.id);
          closed++;
        }
      }
      // 已导入的：店铺说取消了 / 已经发货了 → 关闭，批次里那一行取消勾选，不再回传
      for (const o of imported) {
        if (seen.has(o.ext_id) && !cancelledIds.has(o.ext_id)) continue;
        const st: StoreOrderState | "gone" | undefined = cancelledIds.has(o.ext_id) ? "cancelled" : states ? states[o.ext_id] : complete ? "gone" : undefined;
        if (!st || st === "open") continue;
        closeStoreOrder(o, (hasActiveLabel(o) ? STORE_NOTE_LABELED : STORE_NOTE)[st]);
        closed++;
      }
      c.prepare("UPDATE store_connections SET last_sync_at = datetime('now'), last_error = NULL, status = CASE WHEN status = 'error' THEN 'connected' ELSE status END WHERE id = ?").run(id);
    })();
    // 恢复成“已导入”的订单如果批次里那一行已经删掉了：放回待处理
    releaseOrphans();
    // 同步成功但收件人被平台隐藏：在店铺上提示怎么开权限（不算同步失败）
    if (orders.some((o) => o.issue === "hidden")) {
      c.prepare("UPDATE store_connections SET last_error = ? WHERE id = ?").run(HIDDEN_HINT, id);
    }
    return { added, total: orders.length, closed };
  } catch (e) {
    conn().prepare("UPDATE store_connections SET last_error = ?, last_sync_at = datetime('now') WHERE id = ?").run((e as Error).message.slice(0, 300), id);
    // 授权被撤销 / 过期：标成“连接出错”，客户看到要重新授权
    if (e instanceof StoreAuthError) needsReconnect(id, e.message);
    throw e;
  }
}

/** 各状态的订单数（标签页上的数字），一次查完 */
export function countStoreOrders(customerId: number): Record<StoreOrderStatus, number> {
  const out: Record<StoreOrderStatus, number> = { open: 0, imported: 0, shipped: 0, closed: 0 };
  const rows = conn()
    .prepare("SELECT o.status, COUNT(*) AS n FROM store_orders o JOIN store_connections s ON s.id = o.store_id WHERE s.customer_id = ? GROUP BY o.status")
    .all(customerId) as { status: StoreOrderStatus; n: number }[];
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/** 打开店铺订单页时：超过 5 分钟没同步的店铺先同步一下（最多等几秒，慢了就先显示旧数据） */
export async function syncStaleStores(customerId: number, waitMs = 4000) {
  const stale = listStores(customerId).filter((s) => s.status === "connected" && (!s.lastSyncAt || Date.parse(s.lastSyncAt.replace(" ", "T") + "Z") < Date.now() - 5 * 60_000));
  if (!stale.length) return;
  const all = Promise.allSettled(stale.map((s) => syncStore(s.id)));
  await Promise.race([all, new Promise((r) => setTimeout(r, waitMs))]);
}

export function listStoreOrders(customerId: number, opts: { status?: StoreOrderStatus | "all"; storeId?: number } = {}): StoreOrderRow[] {
  const where = ["s.customer_id = ?"];
  const args: (string | number)[] = [customerId];
  if (opts.storeId) {
    where.push("o.store_id = ?");
    args.push(opts.storeId);
  }
  if (opts.status && opts.status !== "all") {
    where.push("o.status = ?");
    args.push(opts.status);
  }
  const rows = conn()
    .prepare(
      `SELECT o.*, s.platform, COALESCE(NULLIF(s.name, ''), s.shop) AS store_name, r.shipment_id AS row_shipment,
         sh.tracking_no AS tracking_no, sh.status AS shipment_status
       FROM store_orders o JOIN store_connections s ON s.id = o.store_id
       LEFT JOIN batch_job_rows r ON r.job_id = o.job_id AND r.row_no = o.row_no
       LEFT JOIN shipments sh ON sh.id = COALESCE(o.shipment_id, r.shipment_id)
       WHERE ${where.join(" AND ")} ORDER BY o.ordered_at DESC, o.id DESC LIMIT 500`,
    )
    .all(...args) as (Record<string, any>)[];
  return rows.map((r) => {
    const shipmentId = (r.shipment_id ?? r.row_shipment ?? null) as number | null;
    return {
      id: r.id, storeId: r.store_id, platform: r.platform, storeName: r.store_name, extId: r.ext_id, name: r.name, orderedAt: r.ordered_at,
      order: JSON.parse(r.data_json) as StoreOrder, status: r.status, jobId: r.job_id, shipmentId,
      trackingNo: shipmentId ? (r.tracking_no as string | null) ?? null : null, shipmentStatus: (r.shipment_status as string | null) ?? null,
      pushedAt: r.pushed_at, pushError: r.push_error, pushNote: r.push_note ?? null,
    };
  });
}

/* ---------------- 导入批量下单 ---------------- */

export interface DefaultPackage { length: number; width: number; height: number; weight: number; unit: UnitSystem }

/** 平台订单 → 下单请求：收件人、商品来自订单；包裹尺寸用客户选的默认值，重量优先用订单重量 */
export function toShipmentRequest(o: StoreOrder, sender: Address, pkg: DefaultPackage): ShipmentRequest {
  const unit = pkg.unit;
  const weight = Math.max(unit === 1 ? 1 : 0.01, Math.round(pkg.weight * 100) / 100);
  const qty = o.items.reduce((a, i) => a + i.quantity, 0) || 1;
  const skuList: SkuItem[] = o.items.map((i) => ({
    sku: i.sku || i.name.slice(0, 40) || "ITEM",
    productNameCn: "",
    productNameEn: i.name.slice(0, 100),
    quantity: i.quantity,
    declaredUnitPrice: i.unitPrice > 0 ? i.unitPrice : 1,
    declaredCurrency: "USD",
    hsCode: "",
    productNature: "2,4",
    length: pkg.length,
    width: pkg.width,
    height: pkg.height,
    weight: Math.round((weight / qty) * 1000) / 1000,
    unit,
  }));
  // 只有一个名字的收件人：姓也用它（以前同步下来的订单里姓可能是空的）；美国邮编统一写法
  const recipient: Address = { ...o.recipient, nameLast: o.recipient.nameLast?.trim() || o.recipient.nameFirst };
  if (recipient.zipCode && !isInternational({ recipient })) recipient.zipCode = normalizeUsZip(recipient.zipCode);
  return {
    sender,
    recipient,
    pkg: { length: pkg.length, width: pkg.width, height: pkg.height, weight, displayUnitSystem: unit, signServiceType: 0, insuranceService: 0, currency: "USD" },
    skuList,
  };
}

/**
 * 店铺订单在我们系统里的订单号。Shopify 每个店铺的订单号都从 #1001 开始，两个店铺会撞号（撞号的那单就下不了），
 * 所以前面加上店铺简称：“mystore #1001”。eBay 的订单号全平台唯一，照用。
 * 以前导入的订单还是原来的单号（批次里的行、面单都不改），和店铺订单之间靠批次行关联，不受影响。
 */
export function storeOrderRef(platform: Platform, storeName: string, orderName: string): string {
  const name = orderName.trim();
  if (platform !== "shopify") return name.slice(0, 50);
  const short = storeName.trim().replace(/\.myshopify\.com$/i, "").replace(/\s+/g, "-");
  if (!short) return name.slice(0, 50);
  return `${short.slice(0, Math.max(8, 49 - name.length))} ${name}`.slice(0, 50);
}

/** 勾选的订单生成一个批量下单批次，返回批次 ID（之后在批量下单页试算、选渠道、提交） */
export function importToBatch(customerId: number, picks: { id: number; pkg: DefaultPackage }[], createdBy: "admin" | "customer", senderId?: number | null): number {
  if (!picks.length) throw new Error("请勾选要导入的订单");
  // 寄件地址：选了地址簿里的就用它，否则用客户默认寄件地址
  const sender = senderId ? getSender(customerId, senderId)?.address : senderFor(customerId);
  if (!sender?.address1) throw new Error("还没有寄件地址：请先在“账户设置 → 寄件地址簿”里添加寄件地址");
  const pkgOf = new Map(picks.map((p) => [p.id, p.pkg]));
  if (picks.some(({ pkg }) => !(pkg.length > 0 && pkg.width > 0 && pkg.height > 0 && pkg.weight > 0))) throw new Error("勾选的订单要填好长、宽、高和重量");
  const picked = listStoreOrders(customerId, { status: "open" }).filter((r) => pkgOf.has(r.id));
  if (!picked.length) throw new Error("勾选的订单已经导入过或不存在，请刷新");
  // 缺收件地址 / 收件人被隐藏的不能导入
  const rows = picked.filter((r) => !r.order.issue);
  if (!rows.length) throw new Error("勾选的订单收件信息不全，不能导入");
  const orders: ParsedOrder[] = rows.map((r, i) => {
    const req = toShipmentRequest(r.order, sender, pkgOf.get(r.id)!);
    const customerRef = storeOrderRef(r.platform, r.storeName, r.name);
    // 以前（没加店铺简称时）用店铺订单号原样下过单：可能是同一单（或另一个店铺的同号订单），提醒一下、默认不勾选
    const legacy = customerRef !== r.name ? activeShipmentByRef(customerId, r.name) : undefined;
    return {
      rowNo: i + 1,
      customerRef,
      fileChannel: "",
      req,
      // 国际件：批量下单不支持（缺材质等报关信息），直接说去哪里下单，不报一堆校验错误
      errors: isInternational(req) ? [INTL_IMPORT_MSG] : validateRequest(req),
      ...(legacy ? { warning: `订单号 ${r.name} 以前下过单（${legacy.tracking_no ?? legacy.custom_no}），可能是同一单，默认不提交。确认不是同一单再勾选` } : {}),
    };
  });
  const platforms = [...new Set(rows.map((r) => r.platform))].map((p) => (p === "shopify" ? "Shopify" : "eBay")).join(" + ");
  const jobId = createJob({ customerId, createdBy, filename: `${platforms} 订单（${rows.length} 单）`, channels: [], pickMode: "cheapest", orders });
  const up = conn().prepare("UPDATE store_orders SET status = 'imported', job_id = ?, row_no = ?, updated_at = datetime('now') WHERE id = ?");
  conn().transaction(() => rows.forEach((r, i) => up.run(jobId, i + 1, r.id)))();
  return jobId;
}

/** 导入后又从批次里删掉了：放回待处理 */
function releaseOrphans() {
  conn().exec(`UPDATE store_orders SET status = 'open', job_id = NULL, row_no = NULL, updated_at = datetime('now')
    WHERE status = 'imported' AND job_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM batch_job_rows r WHERE r.job_id = store_orders.job_id AND r.row_no = store_orders.row_no)`);
}

/* ---------------- 回传运单号 ---------------- */

function trackingFor(platform: Platform, channelCode: string, trackingNo: string): TrackingPush {
  const ch = displayChannel(channelCode);
  const url = trackingUrl(ch.carrier, trackingNo);
  return { carrier: platform === "shopify" ? shopifyCompany(ch.carrier, ch.name || "Other") : ebayCarrier(ch.carrier), trackingNo, trackingUrl: url };
}

/**
 * 后台每分钟跑一次：
 * - 导入的订单出了面单（有运单号）→ 回传店铺，状态改成“已发货”
 * - 回传过的面单被取消 → Shopify 撤回发货，订单回到“已导入”（重新出单后会再回传新运单号）
 */
/** 店铺是不是测试店铺（Shopify 开发店铺 / eBay 沙盒）；查一次记在店铺配置里 */
async function storeIsSandbox(storeId: number, adapter: PlatformAdapter): Promise<boolean> {
  const r = row(storeId);
  if (!r) return false;
  if (isDemo(r)) return true;
  const cfg = r.config_json ? JSON.parse(r.config_json) : {};
  if (typeof cfg.sandbox === "boolean" && r.platform === "shopify") return cfg.sandbox;
  const v = await adapter.isSandbox();
  if (r.platform === "shopify") conn().prepare("UPDATE store_connections SET config_json = ? WHERE id = ?").run(JSON.stringify({ ...cfg, sandbox: v }), storeId);
  return v;
}

export async function pushPendingFulfillments(limit = 20): Promise<number> {
  releaseOrphans();
  const c = conn();
  const rows = c
    .prepare(
      `SELECT o.id, o.store_id, o.ext_id, o.data_json, o.status, o.shipment_id, o.fulfillment_id, o.push_attempts, o.job_id, o.row_no, r.shipment_id AS row_shipment, s.platform
       FROM store_orders o JOIN store_connections s ON s.id = o.store_id
       JOIN batch_job_rows r ON r.job_id = o.job_id AND r.row_no = o.row_no
       JOIN shipments sh ON sh.id = r.shipment_id
       WHERE r.shipment_id IS NOT NULL
         AND (
           -- 已导入：面单出好了（有运单号、没取消 / 异常）才回传；还在生成中的不占名额
           (o.status = 'imported' AND sh.tracking_no IS NOT NULL AND sh.tracking_no != '' AND sh.status NOT IN ('cancelled', 'pending', 'exception'))
           -- 已回传：面单被取消或批次里换了新单，要撤回
           OR (o.status = 'shipped' AND (o.shipment_id IS NOT r.shipment_id OR o.shipment_id IN (SELECT id FROM shipments WHERE status = 'cancelled')))
         )
         AND (o.push_error IS NULL OR o.updated_at <= datetime('now', '-30 minutes'))
         -- 失败太多次的不再自动重试（页面上提示手动处理）
         AND COALESCE(o.push_attempts, 0) < ${MAX_PUSH_ATTEMPTS}
       ORDER BY o.updated_at
       LIMIT ?`,
    )
    .all(limit) as {
    id: number; store_id: number; ext_id: string; data_json: string; status: StoreOrderStatus; shipment_id: number | null; fulfillment_id: string | null;
    push_attempts: number | null; job_id: number | null; row_no: number | null; row_shipment: number; platform: Platform;
  }[];
  let pushed = 0;
  for (const o of rows) {
    const order = JSON.parse(o.data_json) as StoreOrder;
    // 店铺连上了才算“回传失败”：没授权 / 授权失效的不占重试次数（重新授权后接着回传）
    let connected = false;
    try {
      const adapter = adapterFor(o.store_id);
      connected = true;
      // 之前回传的那张面单取消了（或批次里换成了新单）：先撤回旧的
      const old = o.shipment_id ? getShipment(o.shipment_id) : null;
      if (o.status === "shipped" && (old?.status === "cancelled" || o.shipment_id !== o.row_shipment)) {
        // 没回传过（模拟面单）就不用去店铺撤回
        if (o.platform === "shopify" && o.fulfillment_id) await adapter.cancelFulfillment(o.fulfillment_id);
        c.prepare("UPDATE store_orders SET status = 'imported', shipment_id = NULL, fulfillment_id = NULL, pushed_at = NULL, push_error = NULL, push_note = NULL, push_attempts = 0, updated_at = datetime('now') WHERE id = ?").run(o.id);
        o.status = "imported";
        o.push_attempts = 0;
      }
      const s = getShipment(o.row_shipment);
      if (o.status !== "imported" || !s?.trackingNo || s.status === "cancelled" || s.status === "pending" || s.status === "exception") continue;
      // 模拟面单（内部测试账号 / 测试环境）：只回传到测试店铺，不给正式店铺的真实订单标上假运单号
      if (s.isTest && !(await storeIsSandbox(o.store_id, adapter))) {
        c.prepare("UPDATE store_orders SET status = 'shipped', shipment_id = ?, fulfillment_id = NULL, pushed_at = NULL, push_error = NULL, push_note = ?, updated_at = datetime('now') WHERE id = ?")
          .run(s.id, "模拟面单，没有回传到正式店铺", o.id);
        continue;
      }
      const fid = await adapter.pushFulfillment(order, trackingFor(o.platform, s.channelCode, s.trackingNo));
      c.prepare("UPDATE store_orders SET status = 'shipped', shipment_id = ?, fulfillment_id = ?, pushed_at = datetime('now'), push_error = NULL, push_note = NULL, push_attempts = 0, updated_at = datetime('now') WHERE id = ?").run(s.id, fid, o.id);
      pushed++;
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      if (!connected || e instanceof StoreAuthError) {
        if (e instanceof StoreAuthError) needsReconnect(o.store_id, e.message);
        c.prepare("UPDATE store_orders SET push_error = ?, updated_at = datetime('now') WHERE id = ?").run(msg, o.id);
        continue;
      }
      // 店铺里这单已经取消 / 在别处发货了：不用再试，关掉并提醒（面单不用的话去取消）
      const st = o.status === "imported" ? await storeStateOf(o.store_id, o.ext_id) : undefined;
      if (st === "cancelled" || st === "fulfilled") {
        closeStoreOrder(o, STORE_NOTE_LABELED[st], msg);
        continue;
      }
      // 其他原因：每 30 分钟重试一次，最多 MAX_PUSH_ATTEMPTS 次，之后停下来提示手动处理
      const attempts = (o.push_attempts ?? 0) + 1;
      c.prepare("UPDATE store_orders SET push_error = ?, push_attempts = ?, push_note = ?, updated_at = datetime('now') WHERE id = ?")
        .run(msg, attempts, attempts >= MAX_PUSH_ATTEMPTS ? PUSH_GAVE_UP_NOTE : null, o.id);
    }
  }
  return pushed;
}

/** 回传失败时问一下店铺：这单是不是已经取消 / 发货了（查不到返回 undefined） */
async function storeStateOf(storeId: number, extId: string): Promise<StoreOrderState | undefined> {
  try {
    const a = adapterFor(storeId);
    return a.orderStates ? (await a.orderStates([extId]))[extId] : undefined;
  } catch {
    return undefined;
  }
}

/** 已连接的店铺每 15 分钟自动同步一次未发货订单 */
export async function autoSyncStores() {
  const due = conn()
    .prepare("SELECT id FROM store_connections WHERE status = 'connected' AND customer_id IN (SELECT customer_id FROM store_access) AND (last_sync_at IS NULL OR last_sync_at <= datetime('now', '-15 minutes')) LIMIT 5")
    .all() as { id: number }[];
  for (const { id } of due) await syncStore(id).catch(() => null);
}

/* ---------------- eBay 账户删除通知 ---------------- */

/** eBay 用户删除账号：清掉这个买家的地址等个人信息（订单号保留，方便对账） */
export function forgetEbayUser(username: string) {
  if (!username) return 0;
  const rows = conn().prepare("SELECT o.id, o.data_json FROM store_orders o JOIN store_connections s ON s.id = o.store_id WHERE s.platform = 'ebay' AND o.buyer = ?").all(username) as { id: number; data_json: string }[];
  for (const r of rows) {
    const o = JSON.parse(r.data_json) as StoreOrder;
    o.recipient = { nameFirst: "[deleted]", nameLast: "", country: o.recipient.country, city: "", address1: "", zipCode: "" };
    conn().prepare("UPDATE store_orders SET data_json = ?, buyer = NULL WHERE id = ?").run(JSON.stringify(o), r.id);
  }
  // 卖家自己删号：断开连接
  conn().prepare("UPDATE store_connections SET token_json = NULL, status = 'disconnected' WHERE platform = 'ebay' AND shop = ?").run(username);
  return rows.length;
}
