import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { seedDemo } from "./demo";
import { DEFAULT_STAMP, presetForChannel, type StampOverride, type StampSettings } from "./stampConfig";
import type { MarkupRule, PartialRule } from "./pricing";
import type { Address, PackageInfo, SkuItem, UnitSystem } from "./shipbest/types";

/**
 * 数据目录。正式环境和测试环境（模拟 / 沙盒模式）的数据完全分开：
 * - 正式：DATA_DIR/atrlabels.db（以及面单、充值凭证等文件）
 * - 测试：DATA_DIR/test/ 下面一整套（第一次切到测试模式时从正式数据复制客户、渠道、设置，订单和流水清空）
 * 当前模式记在 DATA_DIR/env.json（不在数据库里，因为要先知道模式才知道打开哪个数据库）。
 */
export function rootDir() {
  return path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "./data");
}

export type StoredMode = "mock" | "sandbox" | "live";
let modeCache: { mode: StoredMode | null; at: number } | null = null;

/** 界面上选的接口模式（env.json）；还没有时从老数据的设置里读出来并保存 */
export function storedMode(): StoredMode | null {
  if (modeCache && Date.now() - modeCache.at < 2000) return modeCache.mode;
  let mode: StoredMode | null = null;
  const file = path.join(rootDir(), "env.json");
  try {
    const m = JSON.parse(fs.readFileSync(file, "utf8")).mode;
    if (m === "mock" || m === "sandbox" || m === "live") mode = m;
  } catch {
    // 老版本：模式存在正式数据库的设置里
    try {
      const r = liveDb().prepare("SELECT value FROM settings WHERE key = 'shipbest'").get() as { value: string } | undefined;
      const m = r ? JSON.parse(r.value).mode : null;
      if (m === "mock" || m === "sandbox" || m === "live") {
        mode = m;
        fs.writeFileSync(file, JSON.stringify({ mode }));
      }
    } catch {
      mode = null;
    }
  }
  modeCache = { mode, at: Date.now() };
  return mode;
}

export function setStoredMode(mode: StoredMode) {
  fs.mkdirSync(rootDir(), { recursive: true });
  fs.writeFileSync(path.join(rootDir(), "env.json"), JSON.stringify({ mode }));
  modeCache = null;
}

/** 当前用的是正式数据还是测试数据 */
export function currentEnv(): "live" | "test" {
  // 单库运行（测试用例、沙盒站自己就是一整套独立数据）
  if (process.env.ATR_SINGLE_DB === "1" || process.env.APP_ENV === "sandbox" || process.env.DB_FILE) return "live";
  const m = storedMode();
  return m === "mock" || m === "sandbox" ? "test" : "live";
}

export function dataDir() {
  return currentEnv() === "test" ? path.join(rootDir(), "test") : rootDir();
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
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  -- topup 充值 / label 出单扣款 / refund 取消退款 / adjustment 账单补差 / manual 手动调账
  type TEXT NOT NULL,
  -- 正数 = 增加客户余额，负数 = 扣款
  amount REAL NOT NULL,
  shipment_id INTEGER REFERENCES shipments(id),
  adjustment_id INTEGER REFERENCES adjustments(id) ON DELETE CASCADE,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_customer ON ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_ledger_shipment ON ledger(shipment_id);
CREATE TABLE IF NOT EXISTS batch_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  created_by TEXT NOT NULL,
  filename TEXT,
  channel_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS batch_job_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
  row_no INTEGER NOT NULL,
  customer_ref TEXT,
  req_json TEXT NOT NULL,
  channel_code TEXT,
  channel_name TEXT,
  price REAL,
  currency TEXT,
  -- pending 待处理 / quoted 已报价 / error 错误 / created 已下单 / failed 下单失败
  status TEXT NOT NULL,
  error TEXT,
  shipment_id INTEGER REFERENCES shipments(id)
);
CREATE INDEX IF NOT EXISTS idx_job_rows ON batch_job_rows(job_id);
CREATE TABLE IF NOT EXISTS topup_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  -- zelle / alipay
  method TEXT NOT NULL,
  -- 申请充值的美元金额
  amount_usd REAL NOT NULL,
  -- 实际支付金额和币种（Zelle 为 USD，支付宝为 CNY）
  pay_amount REAL NOT NULL,
  pay_currency TEXT NOT NULL,
  fx_live REAL,
  fx_rate REAL,
  reference TEXT,
  proof_path TEXT,
  proof_mime TEXT,
  note TEXT,
  -- pending 待确认 / approved 已入账 / rejected 已拒绝
  status TEXT NOT NULL DEFAULT 'pending',
  credited_usd REAL,
  admin_note TEXT,
  ledger_id INTEGER REFERENCES ledger(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  handled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_topup_status ON topup_requests(status);
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  emailed INTEGER NOT NULL DEFAULT 0,
  -- 后台是否已处理（没配置邮件时由客服重置）
  handled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_adj_customer ON adjustments(customer_id);
CREATE INDEX IF NOT EXISTS idx_shipments_created ON shipments(created_at);
`;

/** 给已有数据库补新增的列 */
function migrate(conn: Database.Database) {
  const cols = (conn.prepare("PRAGMA table_info(shipments)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("zone")) conn.exec("ALTER TABLE shipments ADD COLUMN zone TEXT");
  const bcols = (conn.prepare("PRAGMA table_info(adjustment_batches)").all() as { name: string }[]).map((c) => c.name);
  if (!bcols.includes("header_json")) conn.exec("ALTER TABLE adjustment_batches ADD COLUMN header_json TEXT");
  const acols = (conn.prepare("PRAGMA table_info(adjustments)").all() as { name: string }[]).map((c) => c.name);
  if (!acols.includes("raw_json")) conn.exec("ALTER TABLE adjustments ADD COLUMN raw_json TEXT");
  if (!cols.includes("customer_ref")) conn.exec("ALTER TABLE shipments ADD COLUMN customer_ref TEXT");
  if (!cols.includes("created_by")) conn.exec("ALTER TABLE shipments ADD COLUMN created_by TEXT");
  const ccols = (conn.prepare("PRAGMA table_info(customers)").all() as { name: string }[]).map((c) => c.name);
  const jcols = (conn.prepare("PRAGMA table_info(batch_jobs)").all() as { name: string }[]).map((c) => c.name);
  if (!jcols.includes("channels_json")) conn.exec("ALTER TABLE batch_jobs ADD COLUMN channels_json TEXT");
  if (!jcols.includes("pick_mode")) conn.exec("ALTER TABLE batch_jobs ADD COLUMN pick_mode TEXT NOT NULL DEFAULT 'cheapest'");
  const rcols = (conn.prepare("PRAGMA table_info(batch_job_rows)").all() as { name: string }[]).map((c) => c.name);
  if (!rcols.includes("quotes_json")) conn.exec("ALTER TABLE batch_job_rows ADD COLUMN quotes_json TEXT");
  if (!rcols.includes("selected")) conn.exec("ALTER TABLE batch_job_rows ADD COLUMN selected INTEGER NOT NULL DEFAULT 1");
  if (!rcols.includes("file_channel")) conn.exec("ALTER TABLE batch_job_rows ADD COLUMN file_channel TEXT");
  if (!rcols.includes("warning")) conn.exec("ALTER TABLE batch_job_rows ADD COLUMN warning TEXT");
  // 收件地址核对结果（JSON）
  if (!rcols.includes("addr_json")) conn.exec("ALTER TABLE batch_job_rows ADD COLUMN addr_json TEXT");
  const addCust: [string, string][] = [
    ["portal_email", "TEXT"],
    ["password_hash", "TEXT"],
    ["portal_enabled", "INTEGER NOT NULL DEFAULT 0"],
    ["credit_limit", "REAL NOT NULL DEFAULT 0"],
    ["sender_json", "TEXT"],
  ];
  for (const [c, t] of addCust) if (!ccols.includes(c)) conn.exec(`ALTER TABLE customers ADD COLUMN ${c} ${t}`);
  if (!ccols.includes("stamp_mode")) conn.exec("ALTER TABLE customers ADD COLUMN stamp_mode TEXT NOT NULL DEFAULT 'inherit'");
  if (!ccols.includes("label_paper")) conn.exec("ALTER TABLE customers ADD COLUMN label_paper TEXT NOT NULL DEFAULT '4x6'");
  const chcols = (conn.prepare("PRAGMA table_info(channels)").all() as { name: string }[]).map((c) => c.name);
  if (!chcols.includes("stamp_json")) conn.exec("ALTER TABLE channels ADD COLUMN stamp_json TEXT");
  if (!cols.includes("label_note")) conn.exec("ALTER TABLE shipments ADD COLUMN label_note TEXT");
  // 下单时的接口模式：mock / sandbox / live（老数据为空：面单地址是 mock:// 的就是模拟单）
  if (!cols.includes("env")) conn.exec("ALTER TABLE shipments ADD COLUMN env TEXT");
  // 渠道：给客户看的名称、物流商（显示 logo）
  if (!chcols.includes("display_name")) conn.exec("ALTER TABLE channels ADD COLUMN display_name TEXT");
  if (!chcols.includes("carrier")) conn.exec("ALTER TABLE channels ADD COLUMN carrier TEXT");
  // 下单时的收件地址核对结果（JSON）
  if (!cols.includes("addr_check")) conn.exec("ALTER TABLE shipments ADD COLUMN addr_check TEXT");
  conn.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email ON customers(portal_email) WHERE portal_email IS NOT NULL");
  // 客户可用渠道：新客户默认一个都不开，由管理员逐个开通。
  // 第一次建表时，给已有客户开通当前已启用的全部渠道，避免升级后老客户突然无法下单。
  conn.exec(`CREATE TABLE IF NOT EXISTS channel_zips (
    channel_code TEXT NOT NULL,
    zip TEXT NOT NULL,
    zone TEXT,
    PRIMARY KEY (channel_code, zip)
  ) WITHOUT ROWID`);
  conn.exec(`CREATE TABLE IF NOT EXISTS coverage_sources (
    channel_code TEXT PRIMARY KEY,
    filename TEXT,
    sheet TEXT,
    gateway TEXT,
    zip_count INTEGER NOT NULL DEFAULT 0,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const covCols = (conn.prepare("PRAGMA table_info(coverage_sources)").all() as { name: string }[]).map((c) => c.name);
  if (!covCols.includes("prefilter")) conn.exec("ALTER TABLE coverage_sources ADD COLUMN prefilter INTEGER NOT NULL DEFAULT 0");
  // 接口回复“不通邮”的 渠道 + 邮编，记住一段时间，下次直接跳过（结果来自 ShipBest，准确）
  conn.exec(`CREATE TABLE IF NOT EXISTS zip_blocks (
    channel_code TEXT NOT NULL,
    zip TEXT NOT NULL,
    reason TEXT,
    checked_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (channel_code, zip)
  ) WITHOUT ROWID`);
  const hadCustomerChannels = !!conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customer_channels'").get();
  conn.exec(`CREATE TABLE IF NOT EXISTS customer_channels (
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    channel_code TEXT NOT NULL,
    PRIMARY KEY (customer_id, channel_code)
  )`);
  if (!hadCustomerChannels) {
    conn.exec("INSERT OR IGNORE INTO customer_channels (customer_id, channel_code) SELECT cu.id, ch.code FROM customers cu, channels ch WHERE ch.enabled = 1");
  }
}

const g = globalThis as unknown as { __dbs?: Record<string, Database.Database> };

function open(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.exec(SCHEMA);
  migrate(conn);
  return conn;
}

const LIVE_FILE = () => process.env.DB_FILE || path.join(rootDir(), "atrlabels.db");
const TEST_FILE = () => path.join(rootDir(), "test", "atrlabels.db");

/** 正式环境的数据库（不管当前模式） */
export function liveDb(): Database.Database {
  g.__dbs ??= {};
  if (!g.__dbs.live) {
    const conn = open(LIVE_FILE());
    if (process.env.DEMO_SEED === "1") seedDemo(conn);
    g.__dbs.live = conn;
  }
  return g.__dbs.live;
}

/** 关闭正式数据库连接（恢复备份时替换文件用） */
export function closeLiveDb() {
  g.__dbs?.live?.close();
  if (g.__dbs) delete g.__dbs.live;
}

/** 测试环境的数据库：没有时从正式数据复制一份，清空订单、流水、充值、补差 */
function testDb(): Database.Database {
  g.__dbs ??= {};
  if (!g.__dbs.test) {
    const file = TEST_FILE();
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      liveDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      const conn = open(file);
      conn.transaction(() => {
        // 按外键依赖顺序删
        for (const t of ["topup_requests", "ledger", "adjustments", "adjustment_batches", "batch_job_rows", "batch_jobs", "shipments", "password_resets"]) conn.exec(`DELETE FROM ${t}`);
        for (const t of ["mock_orders", "email_log"]) {
          if (conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)) conn.exec(`DELETE FROM ${t}`);
        }
      })();
      g.__dbs.test = conn;
    } else {
      g.__dbs.test = open(file);
    }
  }
  return g.__dbs.test;
}

export function db(): Database.Database {
  return currentEnv() === "test" ? testDb() : liveDb();
}

/** 测试环境重新从正式数据复制（清掉所有测试订单、充值、余额） */
export function resetTestEnv() {
  g.__dbs ??= {};
  g.__dbs.test?.close();
  delete g.__dbs.test;
  const dir = path.join(rootDir(), "test");
  for (const f of ["atrlabels.db", "atrlabels.db-wal", "atrlabels.db-shm"]) fs.rmSync(path.join(dir, f), { force: true });
  for (const sub of ["labels", "topup"]) fs.rmSync(path.join(dir, sub), { recursive: true, force: true });
  if (currentEnv() === "test") testDb();
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
  /** 客户端显示的公司名称 */
  brandName: string;
  /** 客户端显示的客服联系方式 */
  supportContact: string;
  /** 面单加印 SKU */
  stamp: StampSettings;
  /** 下单余额规则，见 ledger.ts */
  balanceRule: "positive" | "cover";
  /** 客户端“充值”页的其他说明 */
  topupInstructions: string;
  /** Zelle 收款信息（邮箱 / 电话 / 户名） */
  zelleInfo: string;
  /** 支付宝收款信息（账号 / 户名） */
  alipayInfo: string;
  /** 是否上传了支付宝收款码 */
  alipayQr: boolean;
  /** 人民币汇率：auto = 实时汇率 + 加点；manual = 固定汇率 + 加点 */
  fxMode: "auto" | "manual";
  /** 在汇率上加的点数，例如 0.03 */
  fxMarkup: number;
  /** 手动 / 备用汇率 */
  fxManualRate: number;
  /** 最近一次成功获取的实时汇率 */
  fxLast: { live: number; source: string; at: string } | null;
  /** 实时汇率多久更新：daily = 每天一次（美西时间当天第一次用到时更新，全天固定）；hourly = 每小时 */
  fxRefresh: "daily" | "hourly";
  /** 当天锁定的汇率 */
  fxDaily: { date: string; live: number; source: string; at: string } | null;
  /** 发货口岸（邮编覆盖表按这个口岸取邮编），91710 Chino 对应 LAX */
  originGateway: string;
  /** ShipBest 接口：在后台“设置”里填写；mode = env 时按服务器环境变量 */
  shipbest: { mode: "env" | "mock" | "sandbox" | "live"; apiId: string; token: string; baseUrl?: string };
  /** 嘉谷万邑（Dragon Open API）尾程面单：第二个服务商 */
  jiagu: { enabled: boolean; clientId: string; secret: string; ownershipId: string; customerId: string; warehouseId: string; warehouses?: Record<string, string>; authUrl?: string; apiUrl?: string };
  /** USPS 地址核对（Addresses API v3） */
  usps: { enabled: boolean; consumerKey: string; consumerSecret: string };
  /** 收件地址核对：服务商、Google 密钥、每月上限 */
  addrCheck: { enabled: boolean; provider: "google" | "usps"; googleKey: string; monthlyCap: number };
  /** 财务确认密码（4 位数字）的哈希 */
  financePin: string | null;
  /** 发件邮箱（SMTP） */
  smtp: { host: string; port: number; user: string; pass: string; from: string };
  /** 邮件通知总开关 */
  notifyEnabled: boolean;
}

/**
 * with_markup 按该单下单时的加价比例转嫁（默认）
 * at_cost 按原金额转嫁（补多少收多少，退多少退多少）
 * none 不转嫁，由我们承担/享有
 */
export type AdjustmentPolicy = "at_cost" | "with_markup" | "none";

export const ADJUSTMENT_POLICY_LABEL: Record<AdjustmentPolicy, string> = {
  with_markup: "按该单加价比例转嫁给客户（例如补收 0.06、加价 5% → 客户补 0.07）",
  at_cost: "按原金额转嫁给客户",
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
  adjustmentPolicy: "with_markup",
  brandName: "ATR Logistics",
  supportContact: "",
  stamp: { ...DEFAULT_STAMP, enabled: false },
  balanceRule: "positive",
  topupInstructions: "",
  zelleInfo: "",
  alipayInfo: "",
  alipayQr: false,
  fxMode: "auto",
  fxMarkup: 0.03,
  fxManualRate: 7.2,
  fxLast: null,
  fxRefresh: "daily",
  fxDaily: null,
  originGateway: "LAX",
  shipbest: { mode: "env", apiId: "", token: "" },
  jiagu: { enabled: false, clientId: "", secret: "", ownershipId: "", customerId: "", warehouseId: "" },
  usps: { enabled: true, consumerKey: "", consumerSecret: "" },
  addrCheck: { enabled: true, provider: "google", googleKey: "", monthlyCap: 5000 },
  financePin: null,
  smtp: { host: "", port: 465, user: "", pass: "", from: "" },
  notifyEnabled: true,
};

export function getSettings(): Settings {
  const rows = db().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = JSON.parse(r.value);
  // 新增字段时旧数据没有，用默认值补齐
  s.stamp = { ...DEFAULT_SETTINGS.stamp, ...(s.stamp as object) };
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
  /** 该渠道面单加印 SKU 的位置（覆盖全局） */
  stamp: StampOverride | null;
  /** 给客户看的名称（空 = 自动去掉仓库邮编后缀） */
  displayName: string | null;
  /** 物流商（空 = 按名称自动识别） */
  carrier: string | null;
}

interface ChannelRow {
  code: string;
  name: string;
  enabled: number;
  markup_percent: number | null;
  markup_fixed: number | null;
  markup_min_profit: number | null;
  synced_at: string | null;
  stamp_json: string | null;
  display_name?: string | null;
  carrier?: string | null;
}

function toChannel(r: ChannelRow): Channel {
  return {
    code: r.code,
    name: r.name,
    enabled: !!r.enabled,
    markup: { percent: r.markup_percent, fixed: r.markup_fixed, minProfit: r.markup_min_profit },
    syncedAt: r.synced_at,
    stamp: r.stamp_json ? JSON.parse(r.stamp_json) : null,
    displayName: r.display_name ?? null,
    carrier: r.carrier ?? null,
  };
}

/** 设置渠道给客户看的名称和物流商（空 = 自动） */
export function setChannelDisplay(code: string, displayName: string | null, carrier: string | null) {
  db().prepare("UPDATE channels SET display_name = ?, carrier = ? WHERE code = ?").run(displayName || null, carrier || null, code);
}

export function setChannelStamp(code: string, stamp: StampOverride | null) {
  db().prepare("UPDATE channels SET stamp_json = ? WHERE code = ?").run(stamp && Object.keys(stamp).length ? JSON.stringify(stamp) : null, code);
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
  // 还没有加印设置的渠道套用预设（USPS 默认加印 SKU）
  const preset = db().prepare("UPDATE channels SET stamp_json = ? WHERE code = ? AND stamp_json IS NULL");
  db().transaction(() =>
    list.forEach((p) => {
      stmt.run(p.code, p.name);
      const pr = presetForChannel(p.name);
      if (pr) preset.run(JSON.stringify(pr), p.code);
    }),
  )();
}

/** 客户已开通的渠道代码（不管渠道是否在全局停用） */
export function customerChannelCodes(customerId: number): string[] {
  return (db().prepare("SELECT channel_code FROM customer_channels WHERE customer_id = ?").all(customerId) as { channel_code: string }[]).map(
    (r) => r.channel_code,
  );
}

/** 客户可以使用的渠道 = 全局已启用 ∩ 给这个客户开通的 */
export function customerChannels(customerId: number): Channel[] {
  const rows = db()
    .prepare(
      `SELECT ch.* FROM channels ch JOIN customer_channels cc ON cc.channel_code = ch.code
       WHERE cc.customer_id = ? AND ch.enabled = 1 ORDER BY ch.name`,
    )
    .all(customerId) as ChannelRow[];
  return rows.map(toChannel);
}

export function customerCanUse(customerId: number, code: string): boolean {
  return customerChannels(customerId).some((c) => c.code === code);
}

export function setCustomerChannels(customerId: number, codes: string[]) {
  const known = new Set(listChannels().map((c) => c.code));
  const list = [...new Set(codes)].filter((c) => known.has(c));
  db().transaction(() => {
    db().prepare("DELETE FROM customer_channels WHERE customer_id = ?").run(customerId);
    const ins = db().prepare("INSERT INTO customer_channels (customer_id, channel_code) VALUES (?, ?)");
    for (const c of list) ins.run(customerId, c);
  })();
}

/** 每个渠道开通给了多少客户（设置页展示用） */
export function channelCustomerCounts(): Record<string, number> {
  const rows = db().prepare("SELECT channel_code, COUNT(*) AS n FROM customer_channels GROUP BY channel_code").all() as { channel_code: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.channel_code, r.n]));
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
  /** 客户登录邮箱 */
  portalEmail: string | null;
  portalEnabled: boolean;
  hasPassword: boolean;
  /** 信用额度：余额最低可以到 -creditLimit */
  creditLimit: number;
  /** 客户默认寄件地址（为空时用系统默认） */
  sender: Address | null;
  /** 当前余额（流水合计） */
  balance: number;
  /** 面单加印 SKU：inherit 跟随全局 / on 加印 / off 不加印 */
  stampMode: "inherit" | "on" | "off";
  /** 面单纸张：4x6 / half / letter / letter2 */
  labelPaper: string;
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
  portal_email: string | null;
  password_hash: string | null;
  portal_enabled: number;
  credit_limit: number;
  sender_json: string | null;
  balance: number | null;
  stamp_mode: "inherit" | "on" | "off" | null;
  label_paper: string | null;
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
    portalEmail: r.portal_email,
    portalEnabled: !!r.portal_enabled,
    hasPassword: !!r.password_hash,
    creditLimit: r.credit_limit ?? 0,
    sender: r.sender_json ? JSON.parse(r.sender_json) : null,
    balance: Math.round((r.balance ?? 0) * 100) / 100,
    stampMode: r.stamp_mode ?? "inherit",
    labelPaper: r.label_paper ?? "4x6",
  };
}

const CUSTOMER_SELECT = `SELECT c.*, (SELECT SUM(l.amount) FROM ledger l WHERE l.customer_id = c.id) AS balance FROM customers c`;

export function listCustomers(): Customer[] {
  return (db().prepare(`${CUSTOMER_SELECT} ORDER BY c.name`).all() as CustomerRow[]).map(toCustomer);
}

export function getCustomer(id: number): Customer | null {
  const r = db().prepare(`${CUSTOMER_SELECT} WHERE c.id = ?`).get(id) as CustomerRow | undefined;
  return r ? toCustomer(r) : null;
}

/** 客户登录用：返回客户和密码哈希 */
export function getCustomerLogin(email: string): { id: number; passwordHash: string | null; enabled: boolean } | null {
  const r = db()
    .prepare("SELECT id, password_hash, portal_enabled FROM customers WHERE portal_email = ? COLLATE NOCASE")
    .get(email.trim()) as { id: number; password_hash: string | null; portal_enabled: number } | undefined;
  return r ? { id: r.id, passwordHash: r.password_hash, enabled: !!r.portal_enabled } : null;
}

export function getPasswordHash(id: number): string | null {
  const r = db().prepare("SELECT password_hash FROM customers WHERE id = ?").get(id) as { password_hash: string | null } | undefined;
  return r?.password_hash ?? null;
}

export function updateCustomerPortal(id: number, p: { email: string | null; enabled: boolean; creditLimit: number }) {
  if (p.email) {
    const dup = db().prepare("SELECT id FROM customers WHERE portal_email = ? COLLATE NOCASE AND id != ?").get(p.email, id);
    if (dup) throw new Error("这个登录邮箱已经被其他客户使用");
  }
  db()
    .prepare("UPDATE customers SET portal_email = ?, portal_enabled = ?, credit_limit = ? WHERE id = ?")
    .run(p.email ? p.email.toLowerCase() : null, p.enabled ? 1 : 0, p.creditLimit, id);
}

export function portalEmailTaken(email: string, exceptId = 0): boolean {
  return !!db().prepare("SELECT id FROM customers WHERE portal_email = ? COLLATE NOCASE AND id != ?").get(email, exceptId);
}

export function setCustomerPassword(id: number, hash: string) {
  db().prepare("UPDATE customers SET password_hash = ? WHERE id = ?").run(hash, id);
}

export function setCustomerStampMode(id: number, mode: "inherit" | "on" | "off") {
  db().prepare("UPDATE customers SET stamp_mode = ? WHERE id = ?").run(mode, id);
}

export function setCustomerLabelPaper(id: number, paper: string) {
  db().prepare("UPDATE customers SET label_paper = ? WHERE id = ?").run(paper, id);
}

export function setCustomerSender(id: number, sender: Address | null) {
  db().prepare("UPDATE customers SET sender_json = ? WHERE id = ?").run(sender ? JSON.stringify(sender) : null, id);
}

export type CustomerInput = Pick<Customer, "name" | "contact" | "phone" | "email" | "note" | "markup">;

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
  /** 客户自己的订单号 */
  customerRef: string | null;
  /** admin / customer */
  createdBy: string | null;
  /** 面单上加印的文字（为空时用 SKU） */
  labelNote: string | null;
  /** 测试单（模拟 / 沙盒模式下的单，面单不是真的） */
  isTest: boolean;
  /** 下单时的收件地址核对结果 */
  addressCheck: { status: string; message?: string } | null;
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
  customer_ref: string | null;
  created_by: string | null;
  label_note: string | null;
  env: string | null;
  addr_check?: string | null;
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
    customerRef: r.customer_ref,
    createdBy: r.created_by,
    labelNote: r.label_note,
    isTest: r.env ? r.env !== "live" : !!r.label_url?.startsWith("mock://"),
    addressCheck: r.addr_check ? JSON.parse(r.addr_check) : null,
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
  customerRef?: string | null;
  createdBy?: string | null;
  env?: string | null;
  addressCheck?: string | null;
}

export function insertShipment(s: NewShipment): number {
  const r = db()
    .prepare(
      `INSERT INTO shipments (custom_no, customer_id, channel_code, channel_name, sender_json, recipient_json,
        package_json, sku_json, quoted_cost, currency, zone, price, rule_json, status, remark, customer_ref, created_by, env, addr_check)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?, ?, ?, ?)`,
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
      s.customerRef ?? null,
      s.createdBy ?? null,
      s.env ?? null,
      s.addressCheck ?? null,
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

export function setLabelNote(id: number, note: string | null) {
  db().prepare("UPDATE shipments SET label_note = ?, updated_at = datetime('now') WHERE id = ?").run(note, id);
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
    where.push("(s.custom_no LIKE ? OR s.order_no LIKE ? OR s.tracking_no LIKE ? OR s.recipient_json LIKE ? OR s.customer_ref LIKE ?)");
    const like = `%${f.q}%`;
    args.push(like, like, like, like, like);
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
/** 单号统一写法：去空格 / 横杠、转大写；USPS 条码“420 + 5 或 9 位邮编 + 运单号”只取后面的运单号 */
export function normalizeTrackingKey(key: string): string {
  const k = key.replace(/[\s-]/g, "").toUpperCase();
  const m = /^420(?:\d{5}|\d{9})(9\d{21})$/.exec(k);
  return m ? m[1] : k;
}

/** 同一客户、同一订单号还有效（没取消）的面单；取消了的可以重新下单 */
export function activeShipmentByRef(customerId: number, ref: string) {
  return db()
    .prepare(
      `SELECT id, custom_no, tracking_no, status, created_at FROM shipments
       WHERE customer_id = ? AND customer_ref = ? AND status <> 'cancelled' ORDER BY id DESC LIMIT 1`,
    )
    .get(customerId, ref.trim()) as { id: number; custom_no: string; tracking_no: string | null; status: ShipmentStatus; created_at: string } | undefined;
}

/** 订单号重复时的提示 */
export function duplicateRefMessage(ref: string, s: { custom_no: string; tracking_no: string | null; created_at: string }) {
  return `订单号 ${ref} 已经下过单（${s.tracking_no ?? s.custom_no}，${s.created_at.slice(0, 10)}），不能重复下单。如需重新下单，请先取消原订单`;
}

export function findShipmentByKey(key: string): {
  id: number; customerId: number; rule: MarkupRule; customNo: string; trackingNo: string | null; customerName: string;
  status: ShipmentStatus; channelName: string | null;
} | null {
  const cols = `SELECT s.id, s.customer_id, s.rule_json, s.custom_no, s.tracking_no, s.status, s.channel_name, c.name AS customer_name
       FROM shipments s JOIN customers c ON c.id = s.customer_id`;
  const exact = db().prepare(`${cols} WHERE s.tracking_no = @k OR s.order_no = @k OR s.custom_no = @k ORDER BY s.id DESC LIMIT 1`);
  // 账单里的单号写法常和系统里不完全一样：多了空格 / 横杠、大小写不同、USPS 条码带“420+邮编”前缀
  const norm = (col: string) => `REPLACE(REPLACE(UPPER(${col}), ' ', ''), '-', '')`;
  const loose = db().prepare(
    `${cols} WHERE ${norm("s.tracking_no")} = @k OR ${norm("s.order_no")} = @k OR ${norm("s.custom_no")} = @k
       OR (length(@k) >= 20 AND ${norm("s.tracking_no")} LIKE '420%' AND substr(${norm("s.tracking_no")}, -length(@k)) = @k)
     ORDER BY s.id DESC LIMIT 1`,
  );
  const k = key.trim();
  const n = normalizeTrackingKey(k);
  const r = (exact.get({ k }) ?? (n ? loose.get({ k: n }) : undefined)) as
    | { id: number; customer_id: number; rule_json: string; custom_no: string; tracking_no: string | null; customer_name: string; status: ShipmentStatus; channel_name: string | null }
    | undefined;
  return r
    ? {
        id: r.id, customerId: r.customer_id, rule: JSON.parse(r.rule_json), customNo: r.custom_no, trackingNo: r.tracking_no,
        customerName: r.customer_name, status: r.status, channelName: r.channel_name,
      }
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
  /** 原始表格这一行（导出给客户时用） */
  raw: string[];
}

export function insertAdjustmentBatch(
  b: { filename: string; fileHash: string; policy: AdjustmentPolicy; note: string | null; header: string[] },
  rows: NewAdjustment[],
): number {
  return db().transaction(() => {
    const r = db()
      .prepare("INSERT INTO adjustment_batches (filename, file_hash, policy, note, header_json) VALUES (?,?,?,?,?)")
      .run(b.filename, b.fileHash, b.policy, b.note, JSON.stringify(b.header));
    const batchId = Number(r.lastInsertRowid);
    const stmt = db().prepare(
      `INSERT INTO adjustments (batch_id, row_no, match_key, shipment_id, customer_id, cost_amount, customer_amount, reason, raw_json)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    );
    for (const a of rows) {
      stmt.run(batchId, a.rowNo, a.matchKey, a.shipmentId, a.customerId, a.costAmount, a.customerAmount, a.reason, JSON.stringify(a.raw));
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
  raw: string[] | null;
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
    cost_amount: number; customer_amount: number; reason: string | null; raw_json: string | null; created_at: string;
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
    raw: r.raw_json ? JSON.parse(r.raw_json) : null,
    createdAt: r.created_at,
  }));
}

export function getBatchHeader(id: number): string[] {
  const r = db().prepare("SELECT header_json FROM adjustment_batches WHERE id = ?").get(id) as { header_json: string | null } | undefined;
  return r?.header_json ? JSON.parse(r.header_json) : [];
}

/** 手动把未匹配的补差行关联到面单 */
export function linkAdjustment(id: number, shipmentId: number, customerId: number, customerAmount: number) {
  db()
    .prepare("UPDATE adjustments SET shipment_id = ?, customer_id = ?, customer_amount = ? WHERE id = ?")
    .run(shipmentId, customerId, customerAmount, id);
}

export function getAdjustment(id: number) {
  return db().prepare("SELECT a.*, b.policy FROM adjustments a JOIN adjustment_batches b ON b.id = a.batch_id WHERE a.id = ?").get(id) as
    | { id: number; batch_id: number; cost_amount: number; shipment_id: number | null; customer_id: number | null; reason: string | null; policy: AdjustmentPolicy }
    | undefined;
}

/** 取消某一条补差和面单的关联（连同钱包里的补差扣 / 退一起撤回），可以重新关联 */
export function unlinkAdjustment(id: number) {
  db().transaction(() => {
    db().prepare("DELETE FROM ledger WHERE adjustment_id = ?").run(id);
    db().prepare("UPDATE adjustments SET shipment_id = NULL, customer_id = NULL, customer_amount = 0 WHERE id = ?").run(id);
  })();
}
