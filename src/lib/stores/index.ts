/**
 * 电商店铺对接（Shopify / eBay）：
 * 1. 店铺连接：保存授权（令牌只在服务器上，页面不显示）
 * 2. 同步未发货订单到本地（店铺订单列表）
 * 3. 客户勾选订单 → 生成批量下单批次（复用批量下单：试算、选渠道、提交、打印）
 * 4. 出单后自动把运单号回传到店铺（后台每分钟检查一次）；取消面单时撤回 Shopify 的发货
 */
import { randomBytes } from "node:crypto";
import { db, getSettings, getShipment } from "../db";
import { createJob, senderFor, type ParsedOrder } from "../batch";
import { validateRequest } from "../service";
import { displayChannel } from "../channelDisplay";
import { trackingUrl } from "../carriers";
import { isMockMode } from "../shipbest/client";
import type { ShipmentRequest, SkuItem, UnitSystem } from "../shipbest/types";
import { DEFAULT_EBAY, EbayAdapter, ebayCarrier, ebayHttp, mockEbayRest, refreshEbayToken, type EbaySettings, type EbayToken } from "./ebay";
import { mockShopifyGraphql, normalizeShop, shopifyCompany, ShopifyAdapter, shopifyHttp, type ShopifyToken } from "./shopify";
import type { Platform, PlatformAdapter, StoreOrder, TrackingPush } from "./types";

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
    CREATE INDEX IF NOT EXISTS store_orders_status ON store_orders (status);`);
    ready = c;
  }
  return c;
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
  openCount: number;
}

interface StoreRow {
  id: number; customer_id: number; platform: Platform; shop: string; name: string; config_json: string | null; token_json: string | null;
  status: StoreStatus; oauth_state: string | null; last_sync_at: string | null; last_error: string | null; created_at: string;
}

function toStore(r: StoreRow): StoreConnection {
  const cfg = r.config_json ? (JSON.parse(r.config_json) as { clientId?: string; clientSecret?: string }) : {};
  const open = (conn().prepare("SELECT COUNT(*) AS n FROM store_orders WHERE store_id = ? AND status = 'open'").get(r.id) as { n: number }).n;
  return {
    id: r.id, customerId: r.customer_id, platform: r.platform, shop: r.shop, name: r.name || r.shop, status: r.status,
    lastSyncAt: r.last_sync_at, lastError: r.last_error, createdAt: r.created_at, clientId: cfg.clientId ?? null, hasSecret: !!cfg.clientSecret, openCount: open,
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
export function saveShopifyStore(input: { id?: number | null; customerId: number; shop: string; clientId: string; clientSecret?: string }): number {
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
  const cfg = JSON.stringify({ clientId, clientSecret });
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
      const a = r.platform === "shopify" ? new ShopifyAdapter(mock as ReturnType<typeof mockShopifyGraphql>) : new EbayAdapter(mock as ReturnType<typeof mockEbayRest>);
      m = Object.assign(a, { mock });
      mocks.set(id, m);
    }
    return m;
  }
  if (r.status !== "connected" || !r.token_json) throw new Error("店铺还没有授权连接");
  const token = JSON.parse(r.token_json) as ShopifyToken & EbayToken;
  if (r.platform === "shopify") return new ShopifyAdapter(shopifyHttp(r.shop, token.accessToken));
  const s = ebaySettings();
  if (!s.enabled || !s.clientId) throw new Error("eBay 对接还没有在后台设置里启用");
  let cur = token;
  return new EbayAdapter(
    ebayHttp(s, async () => {
      // 访问令牌 2 小时过期：提前 5 分钟用刷新令牌换新的
      if (cur.expiresAt && Date.now() > cur.expiresAt - 300_000) {
        const n = await refreshEbayToken(s, cur.refreshToken);
        cur = { ...cur, ...n };
        conn().prepare("UPDATE store_connections SET token_json = ? WHERE id = ?").run(JSON.stringify(cur), id);
      }
      return cur.accessToken;
    }),
  );
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
  pushedAt: string | null;
  pushError: string | null;
}

/** 从店铺拉未发货订单：新的加进来；已导入 / 已发货的不动；店铺里已经不用发的（取消、别处发货）标记关闭 */
export async function syncStore(id: number): Promise<{ added: number; total: number; closed: number }> {
  const r = row(id);
  if (!r) throw new Error("店铺不存在");
  try {
    const { orders, closedExtIds = [] } = await adapterFor(id).fetchOpenOrders();
    const c = conn();
    let added = 0;
    let closed = 0;
    const seen = new Set<string>();
    c.transaction(() => {
      for (const o of orders) {
        seen.add(o.extId);
        const buyer = (o as StoreOrder & { buyer?: string }).buyer ?? null;
        const ex = c.prepare("SELECT id, status FROM store_orders WHERE store_id = ? AND ext_id = ?").get(id, o.extId) as { id: number; status: StoreOrderStatus } | undefined;
        if (!ex) {
          c.prepare("INSERT INTO store_orders (store_id, ext_id, name, ordered_at, data_json, buyer) VALUES (?,?,?,?,?,?)").run(id, o.extId, o.name, o.createdAt, JSON.stringify(o), buyer);
          added++;
        } else if (ex.status === "open" || ex.status === "closed") {
          // 还没导入的：用最新内容（地址可能改过）；之前关掉的又出现了就重新打开
          c.prepare("UPDATE store_orders SET data_json = ?, status = 'open', updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(o), ex.id);
        }
      }
      // 本地还是“待处理”、但店铺已经不在未发货列表里的：关闭
      for (const o of c.prepare("SELECT id, ext_id FROM store_orders WHERE store_id = ? AND status = 'open'").all(id) as { id: number; ext_id: string }[]) {
        if (!seen.has(o.ext_id) || closedExtIds.includes(o.ext_id)) {
          c.prepare("UPDATE store_orders SET status = 'closed', updated_at = datetime('now') WHERE id = ?").run(o.id);
          closed++;
        }
      }
      c.prepare("UPDATE store_connections SET last_sync_at = datetime('now'), last_error = NULL, status = CASE WHEN status = 'error' THEN 'connected' ELSE status END WHERE id = ?").run(id);
    })();
    return { added, total: orders.length, closed };
  } catch (e) {
    conn().prepare("UPDATE store_connections SET last_error = ?, last_sync_at = datetime('now') WHERE id = ?").run((e as Error).message.slice(0, 300), id);
    throw e;
  }
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
      `SELECT o.*, s.platform, COALESCE(NULLIF(s.name, ''), s.shop) AS store_name, r.shipment_id AS row_shipment
       FROM store_orders o JOIN store_connections s ON s.id = o.store_id
       LEFT JOIN batch_job_rows r ON r.job_id = o.job_id AND r.row_no = o.row_no
       WHERE ${where.join(" AND ")} ORDER BY o.ordered_at DESC, o.id DESC LIMIT 500`,
    )
    .all(...args) as (Record<string, any>)[];
  return rows.map((r) => {
    const shipmentId = (r.shipment_id ?? r.row_shipment ?? null) as number | null;
    return {
      id: r.id, storeId: r.store_id, platform: r.platform, storeName: r.store_name, extId: r.ext_id, name: r.name, orderedAt: r.ordered_at,
      order: JSON.parse(r.data_json) as StoreOrder, status: r.status, jobId: r.job_id, shipmentId,
      trackingNo: shipmentId ? getShipment(shipmentId)?.trackingNo ?? null : null, pushedAt: r.pushed_at, pushError: r.push_error,
    };
  });
}

/* ---------------- 导入批量下单 ---------------- */

export interface DefaultPackage { length: number; width: number; height: number; weight: number; unit: UnitSystem }

/** 平台订单 → 下单请求：收件人、商品来自订单；包裹尺寸用客户选的默认值，重量优先用订单重量 */
export function toShipmentRequest(o: StoreOrder, customerId: number, pkg: DefaultPackage): ShipmentRequest {
  const unit = pkg.unit;
  // 订单有重量（克）：换成包裹单位
  const w = o.weightGrams > 0 ? (unit === 3 ? o.weightGrams / 453.59237 : unit === 2 ? o.weightGrams / 1000 : o.weightGrams) : pkg.weight;
  const weight = Math.max(unit === 1 ? 1 : 0.01, Math.round(w * 100) / 100);
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
  return {
    sender: senderFor(customerId) ?? ({} as ShipmentRequest["sender"]),
    recipient: o.recipient,
    pkg: { length: pkg.length, width: pkg.width, height: pkg.height, weight, displayUnitSystem: unit, signServiceType: 0, insuranceService: 0, currency: "USD" },
    skuList,
  };
}

/** 勾选的订单生成一个批量下单批次，返回批次 ID（之后在批量下单页试算、选渠道、提交） */
export function importToBatch(customerId: number, orderIds: number[], pkg: DefaultPackage, createdBy: "admin" | "customer"): number {
  if (!orderIds.length) throw new Error("请勾选要导入的订单");
  if (!(pkg.length > 0 && pkg.width > 0 && pkg.height > 0 && pkg.weight > 0)) throw new Error("请填写默认包裹尺寸和重量");
  const rows = listStoreOrders(customerId, { status: "open" }).filter((r) => orderIds.includes(r.id));
  if (!rows.length) throw new Error("勾选的订单已经导入过或不存在，请刷新");
  const orders: ParsedOrder[] = rows.map((r, i) => {
    const req = toShipmentRequest(r.order, customerId, pkg);
    return { rowNo: i + 1, customerRef: r.name.slice(0, 50), fileChannel: "", req, errors: validateRequest(req) };
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
export async function pushPendingFulfillments(limit = 20): Promise<number> {
  releaseOrphans();
  const c = conn();
  const rows = c
    .prepare(
      `SELECT o.id, o.store_id, o.data_json, o.status, o.shipment_id, o.fulfillment_id, r.shipment_id AS row_shipment, s.platform
       FROM store_orders o JOIN store_connections s ON s.id = o.store_id
       JOIN batch_job_rows r ON r.job_id = o.job_id AND r.row_no = o.row_no
       WHERE o.status IN ('imported', 'shipped') AND r.shipment_id IS NOT NULL
         AND (o.status = 'imported' OR o.shipment_id IS NOT r.shipment_id OR o.shipment_id IN (SELECT id FROM shipments WHERE status = 'cancelled'))
         AND (o.push_error IS NULL OR o.updated_at <= datetime('now', '-30 minutes'))
       LIMIT ?`,
    )
    .all(limit) as { id: number; store_id: number; data_json: string; status: StoreOrderStatus; shipment_id: number | null; fulfillment_id: string | null; row_shipment: number; platform: Platform }[];
  let pushed = 0;
  for (const o of rows) {
    const order = JSON.parse(o.data_json) as StoreOrder;
    try {
      const adapter = adapterFor(o.store_id);
      // 之前回传的那张面单取消了（或批次里换成了新单）：先撤回旧的
      const old = o.shipment_id ? getShipment(o.shipment_id) : null;
      if (o.status === "shipped" && o.fulfillment_id && (old?.status === "cancelled" || o.shipment_id !== o.row_shipment)) {
        if (o.platform === "shopify") await adapter.cancelFulfillment(o.fulfillment_id);
        c.prepare("UPDATE store_orders SET status = 'imported', shipment_id = NULL, fulfillment_id = NULL, pushed_at = NULL, push_error = NULL, updated_at = datetime('now') WHERE id = ?").run(o.id);
        o.status = "imported";
      }
      const s = getShipment(o.row_shipment);
      if (o.status !== "imported" || !s?.trackingNo || s.status === "cancelled" || s.status === "pending" || s.status === "exception") continue;
      const fid = await adapter.pushFulfillment(order, trackingFor(o.platform, s.channelCode, s.trackingNo));
      c.prepare("UPDATE store_orders SET status = 'shipped', shipment_id = ?, fulfillment_id = ?, pushed_at = datetime('now'), push_error = NULL, updated_at = datetime('now') WHERE id = ?").run(s.id, fid, o.id);
      pushed++;
    } catch (e) {
      c.prepare("UPDATE store_orders SET push_error = ?, updated_at = datetime('now') WHERE id = ?").run((e as Error).message.slice(0, 300), o.id);
    }
  }
  return pushed;
}

/** 已连接的店铺每 15 分钟自动同步一次未发货订单 */
export async function autoSyncStores() {
  const due = conn()
    .prepare("SELECT id FROM store_connections WHERE status = 'connected' AND (last_sync_at IS NULL OR last_sync_at <= datetime('now', '-15 minutes')) LIMIT 5")
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
