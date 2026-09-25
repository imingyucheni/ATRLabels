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
CREATE INDEX IF NOT EXISTS idx_shipments_created ON shipments(created_at);
`;

const g = globalThis as unknown as { __db?: Database.Database };

export function db(): Database.Database {
  if (!g.__db) {
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    const conn = new Database(process.env.DB_FILE || path.join(dir, "atrlabels.db"));
    conn.pragma("journal_mode = WAL");
    conn.pragma("foreign_keys = ON");
    conn.exec(SCHEMA);
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
}

const DEFAULT_SETTINGS: Settings = {
  markup: { percent: 5, fixed: 0, minProfit: 0 },
  roundingStep: 0.01,
  cancelFeePercent: 10,
  sbCancelFeePercent: 10,
  defaultUnit: 3,
  defaultCurrency: "USD",
  sender: null,
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
  price: number;
  rule: MarkupRule;
  remark: string | null;
}

export function insertShipment(s: NewShipment): number {
  const r = db()
    .prepare(
      `INSERT INTO shipments (custom_no, customer_id, channel_code, channel_name, sender_json, recipient_json,
        package_json, sku_json, quoted_cost, currency, price, rule_json, status, remark)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)`,
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

export function getShipment(id: number): Shipment | null {
  const r = db()
    .prepare(
      `SELECT s.*, c.name AS customer_name FROM shipments s JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`,
    )
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
  const sql = `SELECT s.*, c.name AS customer_name FROM shipments s JOIN customers c ON c.id = s.customer_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY s.id DESC ${f.limit ? `LIMIT ${Number(f.limit)}` : ""}`;
  return (db().prepare(sql).all(...args) as ShipmentRow[]).map(toShipment);
}

/**
 * 单票利润：
 * - 正常：客户价 - 成本（有实扣用实扣，否则用试算成本）
 * - 已取消：向客户收取的取消手续费 - ShipBest 收取的取消费
 * - 异常（未出单）：不计
 */
export function shipmentProfit(s: Shipment): number | null {
  if (s.status === "cancelled") return (s.cancelFee ?? 0) - (s.sbCancelFee ?? 0);
  if (s.status === "exception") return null;
  return s.price - (s.actualCost ?? s.quotedCost);
}
