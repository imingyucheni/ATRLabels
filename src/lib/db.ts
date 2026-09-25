import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { MarkupRule, PartialRule } from "./pricing";
import type { Address, PackageInfo, SkuItem, UnitSystem } from "./shipbest/types";

export function dataDir() {
  return path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "./data");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  markup_percent REAL,
  markup_fixed REAL,
  markup_min_profit REAL,
  synced_at TEXT
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT,
  phone TEXT,
  email TEXT,
  note TEXT,
  markup_percent REAL,
  markup_fixed REAL,
  markup_min_profit REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  custom_no TEXT NOT NULL UNIQUE,
  order_no TEXT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  channel_code TEXT NOT NULL,
  channel_name TEXT,
  sender_json TEXT NOT NULL,
  recipient_json TEXT NOT NULL,
  package_json TEXT NOT NULL,
  sku_json TEXT NOT NULL,
  quoted_cost REAL NOT NULL,
  currency TEXT NOT NULL,
  price REAL NOT NULL,
  rule_json TEXT NOT NULL,
  actual_cost REAL,
  sb_status INTEGER,
  status TEXT NOT NULL,
  error_msg TEXT,
  tracking_no TEXT,
  label_url TEXT,
  label_path TEXT,
  label_mime TEXT,
  cancel_fee REAL,
  sb_cancel_fee REAL,
  refund_amount REAL,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_shipments_customer ON shipments(customer_id);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments(tracking_no);
CREATE TABLE IF NOT EXISTS adjustment_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  file_hash TEXT NOT NULL UNIQUE,
  policy TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES adjustment_batches(id) ON DELETE CASCADE,
  row_no INTEGER NOT NULL,
  match_key TEXT NOT NULL,
  shipment_id INTEGER REFERENCES shipments(id),
  customer_id INTEGER REFERENCES customers(id),
  cost_amount REAL NOT NULL,
  customer_amount REAL NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_adj_shipment ON adjustments(shipment_id);
CREATE INDEX IF NOT EXISTS idx_adj_customer ON adjustments(customer_id);
CREATE INDEX IF NOT EXISTS idx_shipments_created ON shipments(created_at);
`;

/** 给已有数据库补新增的列 */
function migrate(conn: Database.Database) {
  const cols = (conn.prepare("PRAGMA table_info(shipments)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("zone")) conn.exec("ALTER TABLE shipments ADD COLUMN zone TEXT");
}

const g = globalThis as unknown as { __db?: Database.Database };

export function db(): Database.Database {
  if (!g.__db) {
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    const conn = new Database(process.env.DB_FILE || path.join(dir, "atrlabels.db"));
    conn.pragma("journal_mode = WAL");
    conn.pragma("foreign_keys = ON");
    conn.exec(SCHEMA);
    migrate(conn);
    g.__db = conn;
  }
  return g.__db;
}

/* ---------------- 设置 ---------------- */

export interface Settings {
  markup: MarkupRule;
  /** 报价取整步长，0.01 / 0.1 / 1 */
  roundingStep: number;
  /** 取消订单时向客户收取的手续费比例（%） */
  cancelFeePercent: number;
  /** ShipBest 取消订单向我们收取的费用比例（%） */
  sbCancelFeePercent: number;
  defaultUnit: UnitSystem;
  defaultCurrency: string;
  sender: Address | null;
  /** 官方账单补差如何转嫁给客户 */
  adjustmentPolicy: AdjustmentPolicy;
}

/**
 * at_cost 按原金额转嫁（补多少收多少，退多少退多少）
 * with_markup 按该单的加价比例转嫁
 * none 不转嫁，由我们承担/享有
 */
export type AdjustmentPolicy = "at_cost" | "with_markup" | "none";

export const ADJUSTMENT_POLICY_LABEL: Record<AdjustmentPolicy, string> = {
  at_cost: "按原金额转嫁给客户",
  with_markup: "按该单加价比例转嫁给客户",
  none: "不转嫁（我们自己承担/享有）",
};

const DEFAULT_SETTINGS: Settings = {
  markup: { percent: 5, fixed: 0, minProfit: 0 },
  roundingStep: 0.01,
  cancelFeePercent: 10,
  sbCancelFeePercent: 10,
  defaultUnit: 3,
  defaultCurrency: "USD",
  sender: null,
  adjustmentPolicy: "at_cost",
};

export function getSettings(): Settings {
  const rows = db().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = JSON.parse(r.value);
  return s as unknown as Settings;
}

export function saveSettings(patch: Partial<Settings>) {
  const stmt = db().prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const tx = db().transaction(() => {
    for (const [k, v] of Object.entries(patch)) stmt.run(k, JSON.stringify(v));
  });
  tx();
}

/* ---------------- 渠道 ---------------- */

export interface Channel {
  code: string;
  name: string;
  enabled: boolean;
  markup: PartialRule;
  syncedAt: string | null;
}

interface ChannelRow {
  code: string;
  name: string;
  enabled: number;
  markup_percent: number | null;
  markup_fixed: number | null;
  markup_min_profit: number | null;
  synced_at: string | null;
}

function toChannel(r: ChannelRow): Channel {
  return {
    code: r.code,
    name: r.name,
    enabled: !!r.enabled,
    markup: { percent: r.markup_percent, fixed: r.markup_fixed, minProfit: r.markup_min_profit },
    syncedAt: r.synced_at,
  };
}

export function listChannels(onlyEnabled = false): Channel[] {
  const rows = db()
    .prepare(`SELECT * FROM channels ${onlyEnabled ? "WHERE enabled = 1" : ""} ORDER BY name`)
    .all() as ChannelRow[];
  return rows.map(toChannel);
}

export function getChannel(code: string): Channel | null {
  const r = db().prepare("SELECT * FROM channels WHERE code = ?").get(code) as ChannelRow | undefined;
  return r ? toChannel(r) : null;
}

/** 同步 ShipBest 渠道列表：新增的默认启用，已有的只更新名称。 */
export function upsertChannels(list: { code: string; name: string }[]) {
  const stmt = db().prepare(
    `INSERT INTO channels (code, name, synced_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(code) DO UPDATE SET name = excluded.name, synced_at = excluded.synced_at`,
  );
  db().transaction(() => list.forEach((p) => stmt.run(p.code, p.name)))();
}

export function updateChannel(code: string, enabled: boolean, markup: PartialRule) {
  db()
    .prepare(
      "UPDATE channels SET enabled = ?, markup_percent = ?, markup_fixed = ?, markup_min_profit = ? WHERE code = ?",
    )
    .run(enabled ? 1 : 0, markup.percent ?? null, markup.fixed ?? null, markup.minProfit ?? null, code);
}

/* ---------------- 客户 ---------------- */

export interface Customer {
  id: number;
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  markup: PartialRule;
  createdAt: string;
}

interface CustomerRow {
  id: number;
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  markup_percent: number | null;
  markup_fixed: number | null;
  markup_min_profit: number | null;
  created_at: string;
}

function toCustomer(r: CustomerRow): Customer {
  return {
    id: r.id,
    name: r.name,
    contact: r.contact,
    phone: r.phone,
    email: r.email,
    note: r.note,
    markup: { percent: r.markup_percent, fixed: r.markup_fixed, minProfit: r.markup_min_profit },
    createdAt: r.created_at,
  };
}

export function listCustomers(): Customer[] {
  return (db().prepare("SELECT * FROM customers ORDER BY name").all() as CustomerRow[]).map(toCustomer);
}

export function getCustomer(id: number): Customer | null {
  const r = db().prepare("SELECT * FROM customers WHERE id = ?").get(id) as CustomerRow | undefined;
  return r ? toCustomer(r) : null;
}

export type CustomerInput = Omit<Customer, "id" | "createdAt">;

export function saveCustomer(id: number | null, c: CustomerInput): number {
  const vals = [
    c.name,
    c.contact,
    c.phone,
    c.email,
    c.note,
    c.markup.percent ?? null,
    c.markup.fixed ?? null,
    c.markup.minProfit ?? null,
  ];
  if (id) {
    db()
      .prepare(
        `UPDATE customers SET name=?, contact=?, phone=?, email=?, note=?,
         markup_percent=?, markup_fixed=?, markup_min_profit=? WHERE id=?`,
      )
      .run(...vals, id);
    return id;
  }
  const r = db()
    .prepare(
      `INSERT INTO customers (name, contact, phone, email, note, markup_percent, markup_fixed, markup_min_profit)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(...vals);
  return Number(r.lastInsertRowid);
}

/* ---------------- 面单 / 订单 ---------------- */

/**
 * 本地状态：
 * pending 已提交等待出单 / labeled 已出面单 / exception 异常 /
 * cancel_requested 已申请取消（等 ShipBest 人工处理）/ cancelled 已取消
 */
export type ShipmentStatus = "pending" | "labeled" | "exception" | "cancel_requested" | "cancelled";

export const STATUS_LABEL: Record<ShipmentStatus, string> = {
  pending: "等待出单",
  labeled: "已出面单",
  exception: "异常",
  cancel_requested: "取消处理中",
  cancelled: "已取消",
};

export interface Shipment {
  id: number;
  customNo: string;
  orderNo: string | null;
  customerId: number;
  customerName?: string;
  channelCode: string;
  channelName: string | null;
  sender: Address;
  recipient: Address;
  pkg: PackageInfo;
  skuList: SkuItem[];
  quotedCost: number;
  currency: string;
  /** 下单时试算返回的分区 */
  zone: string | null;
  price: number;
  rule: MarkupRule;
  actualCost: number | null;
  sbStatus: number | null;
  status: ShipmentStatus;
  errorMsg: string | null;
  trackingNo: string | null;
  labelUrl: string | null;
  labelPath: string | null;
  labelMime: string | null;
  cancelFee: number | null;
  sbCancelFee: number | null;
  refundAmount: number | null;
  remark: string | null;
  /** 官方账单补差合计：正数 = ShipBest 向我们补扣，负数 = 退给我们 */
  costAdj: number;
  /** 向客户补收（正）/ 退客户（负）的合计 */
  customerAdj: number;
  createdAt: string;
  updatedAt: string;
}

interface ShipmentRow {
  id: number;
  custom_no: string;
  order_no: string | null;
  customer_id: number;
  customer_name?: string;
  channel_code: string;
  channel_name: string | null;
  sender_json: string;
  recipient_json: string;
  package_json: string;
  sku_json: string;
  quoted_cost: number;
  currency: string;
  zone: string | null;
  price: number;
  rule_json: string;
  actual_cost: number | null;
  sb_status: number | null;
  status: ShipmentStatus;
  error_msg: string | null;
  tracking_no: string | null;
  label_url: string | null;
  label_path: string | null;
  label_mime: string | null;
  cancel_fee: number | null;
  sb_cancel_fee: number | null;
  refund_amount: number | null;
  remark: string | null;
  cost_adj: number | null;
  customer_adj: number | null;
  created_at: string;
  updated_at: string;
}

function toShipment(r: ShipmentRow): Shipment {
  return {
    id: r.id,
    customNo: r.custom_no,
    orderNo: r.order_no,
    customerId: r.customer_id,
    customerName: r.customer_name,
    channelCode: r.channel_code,
    channelName: r.channel_name,
    sender: JSON.parse(r.sender_json),
    recipient: JSON.parse(r.recipient_json),
    pkg: JSON.parse(r.package_json),
    skuList: JSON.parse(r.sku_json),
    quotedCost: r.quoted_cost,
    currency: r.currency,
    zone: r.zone,
    price: r.price,
    rule: JSON.parse(r.rule_json),
    actualCost: r.actual_cost,
    sbStatus: r.sb_status,
    status: r.status,
    errorMsg: r.error_msg,
    trackingNo: r.tracking_no,
    labelUrl: r.label_url,
    labelPath: r.label_path,
    labelMime: r.label_mime,
    cancelFee: r.cancel_fee,
    sbCancelFee: r.sb_cancel_fee,
    refundAmount: r.refund_amount,
    remark: r.remark,
    costAdj: r.cost_adj ?? 0,
    customerAdj: r.customer_adj ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface NewShipment {
  customNo: string;
  customerId: number;
  channelCode: string;
  channelName: string | null;
  sender: Address;
  recipient: Address;
  pkg: PackageInfo;
  skuList: SkuItem[];
  quotedCost: number;
  currency: string;
  zone: string | null;
  price: number;
  rule: MarkupRule;
  remark: string | null;
}

export function insertShipment(s: NewShipment): number {
  const r = db()
    .prepare(
      `INSERT INTO shipments (custom_no, customer_id, channel_code, channel_name, sender_json, recipient_json,
        package_json, sku_json, quoted_cost, currency, zone, price, rule_json, status, remark)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)`,
    )
    .run(
      s.customNo,
      s.customerId,
      s.channelCode,
      s.channelName,
      JSON.stringify(s.sender),
      JSON.stringify(s.recipient),
      JSON.stringify(s.pkg),
      JSON.stringify(s.skuList),
      s.quotedCost,
      s.currency,
      s.zone,
      s.price,
      JSON.stringify(s.rule),
      s.remark,
    );
  return Number(r.lastInsertRowid);
}

const COLUMN_MAP: Record<string, string> = {
  orderNo: "order_no",
  actualCost: "actual_cost",
  sbStatus: "sb_status",
  status: "status",
  errorMsg: "error_msg",
  trackingNo: "tracking_no",
  labelUrl: "label_url",
  labelPath: "label_path",
  labelMime: "label_mime",
  cancelFee: "cancel_fee",
  sbCancelFee: "sb_cancel_fee",
  refundAmount: "refund_amount",
};

export type ShipmentPatch = Partial<
  Pick<
    Shipment,
    | "orderNo"
    | "actualCost"
    | "sbStatus"
    | "status"
    | "errorMsg"
    | "trackingNo"
    | "labelUrl"
    | "labelPath"
    | "labelMime"
    | "cancelFee"
    | "sbCancelFee"
    | "refundAmount"
  >
>;

export function updateShipment(id: number, patch: ShipmentPatch) {
  const entries = Object.entries(patch).filter(([k, v]) => COLUMN_MAP[k] && v !== undefined);
  if (!entries.length) return;
  const sets = entries.map(([k]) => `${COLUMN_MAP[k]} = ?`).join(", ");
  db()
    .prepare(`UPDATE shipments SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
    .run(...entries.map(([, v]) => v as string | number | null), id);
}

export function deleteShipment(id: number) {
  db().prepare("DELETE FROM shipments WHERE id = ?").run(id);
}

const SHIPMENT_SELECT = `SELECT s.*, c.name AS customer_name,
  (SELECT SUM(a.cost_amount) FROM adjustments a WHERE a.shipment_id = s.id) AS cost_adj,
  (SELECT SUM(a.customer_amount) FROM adjustments a WHERE a.shipment_id = s.id) AS customer_adj
  FROM shipments s JOIN customers c ON c.id = s.customer_id`;

export function getShipment(id: number): Shipment | null {
  const r = db()
    .prepare(`${SHIPMENT_SELECT} WHERE s.id = ?`)
    .get(id) as ShipmentRow | undefined;
  return r ? toShipment(r) : null;
}

export interface ShipmentFilter {
  customerId?: number;
  status?: string;
  from?: string; // yyyy-mm-dd
  to?: string; // yyyy-mm-dd
  q?: string;
  limit?: number;
}

export function listShipments(f: ShipmentFilter = {}): Shipment[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.customerId) {
    where.push("s.customer_id = ?");
    args.push(f.customerId);
  }
  if (f.status) {
    where.push("s.status = ?");
    args.push(f.status);
  }
  // created_at 存的是 UTC，这里按日期字符串比较（足够用于对账筛选）
  if (f.from) {
    where.push("date(s.created_at, 'localtime') >= ?");
    args.push(f.from);
  }
  if (f.to) {
    where.push("date(s.created_at, 'localtime') <= ?");
    args.push(f.to);
  }
  if (f.q) {
    where.push("(s.custom_no LIKE ? OR s.order_no LIKE ? OR s.tracking_no LIKE ? OR s.recipient_json LIKE ?)");
    const like = `%${f.q}%`;
    args.push(like, like, like, like);
  }
  const sql = `${SHIPMENT_SELECT}
    ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY s.id DESC ${f.limit ? `LIMIT ${Number(f.limit)}` : ""}`;
  return (db().prepare(sql).all(...args) as ShipmentRow[]).map(toShipment);
}

/**
 * 单票利润：
 * - 正常：客户价 - 成本（有实扣用实扣，否则用试算成本）
 * - 已取消：向客户收取的取消手续费 - ShipBest 收取的取消费
 * - 异常（未出单）：不计
 * 再加上官方账单补差：向客户补收的 - ShipBest 补扣的
 */
export function shipmentProfit(s: Shipment): number | null {
  const adj = s.customerAdj - s.costAdj;
  if (s.status === "cancelled") return (s.cancelFee ?? 0) - (s.sbCancelFee ?? 0) + adj;
  if (s.status === "exception") return null;
  return s.price - (s.actualCost ?? s.quotedCost) + adj;
}

/** 该单应收客户合计（含取消手续费和补差） */
export function shipmentReceivable(s: Shipment): number {
  if (s.status === "exception") return 0;
  return (s.status === "cancelled" ? s.cancelFee ?? 0 : s.price) + s.customerAdj;
}

/** 该单我们的总成本（含 ShipBest 取消费和补差） */
export function shipmentCost(s: Shipment): number {
  if (s.status === "exception") return 0;
  return (s.status === "cancelled" ? s.sbCancelFee ?? 0 : s.actualCost ?? s.quotedCost) + s.costAdj;
}

/* ---------------- 官方账单补差 ---------------- */

/** 按运单号 / ShipBest 单号 / 自定义单号查找面单 */
export function findShipmentByKey(key: string): { id: number; customerId: number; rule: MarkupRule; customNo: string; trackingNo: string | null; customerName: string } | null {
  const r = db()
    .prepare(
      `SELECT s.id, s.customer_id, s.rule_json, s.custom_no, s.tracking_no, c.name AS customer_name
       FROM shipments s JOIN customers c ON c.id = s.customer_id
       WHERE s.tracking_no = @k OR s.order_no = @k OR s.custom_no = @k ORDER BY s.id DESC LIMIT 1`,
    )
    .get({ k: key }) as { id: number; customer_id: number; rule_json: string; custom_no: string; tracking_no: string | null; customer_name: string } | undefined;
  return r
    ? { id: r.id, customerId: r.customer_id, rule: JSON.parse(r.rule_json), customNo: r.custom_no, trackingNo: r.tracking_no, customerName: r.customer_name }
    : null;
}

export function batchExists(fileHash: string) {
  return !!db().prepare("SELECT 1 FROM adjustment_batches WHERE file_hash = ?").get(fileHash);
}

export interface NewAdjustment {
  rowNo: number;
  matchKey: string;
  shipmentId: number | null;
  customerId: number | null;
  costAmount: number;
  customerAmount: number;
  reason: string | null;
}

export function insertAdjustmentBatch(
  b: { filename: string; fileHash: string; policy: AdjustmentPolicy; note: string | null },
  rows: NewAdjustment[],
): number {
  return db().transaction(() => {
    const r = db()
      .prepare("INSERT INTO adjustment_batches (filename, file_hash, policy, note) VALUES (?,?,?,?)")
      .run(b.filename, b.fileHash, b.policy, b.note);
    const batchId = Number(r.lastInsertRowid);
    const stmt = db().prepare(
      `INSERT INTO adjustments (batch_id, row_no, match_key, shipment_id, customer_id, cost_amount, customer_amount, reason)
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    for (const a of rows) {
      stmt.run(batchId, a.rowNo, a.matchKey, a.shipmentId, a.customerId, a.costAmount, a.customerAmount, a.reason);
    }
    return batchId;
  })();
}

export function deleteAdjustmentBatch(id: number) {
  db().prepare("DELETE FROM adjustment_batches WHERE id = ?").run(id);
}

export interface AdjustmentBatch {
  id: number;
  filename: string;
  policy: AdjustmentPolicy;
  note: string | null;
  createdAt: string;
  rowCount: number;
  matchedCount: number;
  costTotal: number;
  customerTotal: number;
}

export function listAdjustmentBatches(): AdjustmentBatch[] {
  return (
    db()
      .prepare(
        `SELECT b.*, COUNT(a.id) AS row_count, COUNT(a.shipment_id) AS matched_count,
          COALESCE(SUM(a.cost_amount), 0) AS cost_total,
          COALESCE(SUM(CASE WHEN a.shipment_id IS NOT NULL THEN a.customer_amount END), 0) AS customer_total
         FROM adjustment_batches b LEFT JOIN adjustments a ON a.batch_id = b.id
         GROUP BY b.id ORDER BY b.id DESC`,
      )
      .all() as {
      id: number; filename: string; policy: AdjustmentPolicy; note: string | null; created_at: string;
      row_count: number; matched_count: number; cost_total: number; customer_total: number;
    }[]
  ).map((r) => ({
    id: r.id,
    filename: r.filename,
    policy: r.policy,
    note: r.note,
    createdAt: r.created_at,
    rowCount: r.row_count,
    matchedCount: r.matched_count,
    costTotal: r.cost_total,
    customerTotal: r.customer_total,
  }));
}

export function getAdjustmentBatch(id: number): AdjustmentBatch | null {
  return listAdjustmentBatches().find((b) => b.id === id) ?? null;
}

export interface Adjustment {
  id: number;
  batchId: number;
  batchFilename: string;
  rowNo: number;
  matchKey: string;
  shipmentId: number | null;
  customNo: string | null;
  trackingNo: string | null;
  customerId: number | null;
  customerName: string | null;
  costAmount: number;
  customerAmount: number;
  reason: string | null;
  createdAt: string;
}

export function listAdjustments(f: { batchId?: number; shipmentId?: number; customerId?: number; from?: string; to?: string }): Adjustment[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.batchId) { where.push("a.batch_id = ?"); args.push(f.batchId); }
  if (f.shipmentId) { where.push("a.shipment_id = ?"); args.push(f.shipmentId); }
  if (f.customerId) { where.push("a.customer_id = ?"); args.push(f.customerId); }
  if (f.from) { where.push("date(a.created_at, 'localtime') >= ?"); args.push(f.from); }
  if (f.to) { where.push("date(a.created_at, 'localtime') <= ?"); args.push(f.to); }
  const rows = db()
    .prepare(
      `SELECT a.*, b.filename, s.custom_no, s.tracking_no, c.name AS customer_name
       FROM adjustments a JOIN adjustment_batches b ON b.id = a.batch_id
       LEFT JOIN shipments s ON s.id = a.shipment_id LEFT JOIN customers c ON c.id = a.customer_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY a.batch_id DESC, a.row_no`,
    )
    .all(...args) as {
    id: number; batch_id: number; filename: string; row_no: number; match_key: string; shipment_id: number | null;
    custom_no: string | null; tracking_no: string | null; customer_id: number | null; customer_name: string | null;
    cost_amount: number; customer_amount: number; reason: string | null; created_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    batchId: r.batch_id,
    batchFilename: r.filename,
    rowNo: r.row_no,
    matchKey: r.match_key,
    shipmentId: r.shipment_id,
    customNo: r.custom_no,
    trackingNo: r.tracking_no,
    customerId: r.customer_id,
    customerName: r.customer_name,
    costAmount: r.cost_amount,
    customerAmount: r.customer_amount,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

/** 手动把未匹配的补差行关联到面单 */
export function linkAdjustment(id: number, shipmentId: number, customerId: number, customerAmount: number) {
  db()
    .prepare("UPDATE adjustments SET shipment_id = ?, customer_id = ?, customer_amount = ? WHERE id = ?")
    .run(shipmentId, customerId, customerAmount, id);
}

export function getAdjustment(id: number) {
  return db().prepare("SELECT a.*, b.policy FROM adjustments a JOIN adjustment_batches b ON b.id = a.batch_id WHERE a.id = ?").get(id) as
    | { id: number; cost_amount: number; shipment_id: number | null; policy: AdjustmentPolicy }
    | undefined;
}
