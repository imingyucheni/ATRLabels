/**
 * 批量下单：上传 Excel/CSV → 解析分组 → 后台逐单报价 → 确认 → 后台逐单下单 → 刷新面单 → 合并打印。
 * 任务在服务进程里后台执行，页面轮询进度；服务重启后打开任务页会自动继续。
 */
import ExcelJS from "exceljs";
import { db, getChannel, getCustomer, getSettings, getShipment, listChannels } from "./db";
import { InsufficientBalanceError } from "./ledger";
import { createLabel, PriceChangedError, quoteAll, quoteChannel, refreshShipment, validateRequest } from "./service";
import type { Address, ShipmentRequest, SkuItem, UnitSystem } from "./shipbest/types";
import { JOB_STATUS_LABEL, type JobStatus } from "./batchLabels";

export { JOB_STATUS_LABEL, type JobStatus };

/* ---------------- 模板 ---------------- */

type Field =
  | "customerRef" | "nameFirst" | "nameLast" | "phone" | "email" | "corporateName" | "country" | "province" | "city"
  | "zipCode" | "address1" | "address2" | "length" | "width" | "height" | "weight" | "unit" | "sign" | "sku"
  | "productNameCn" | "productNameEn" | "quantity" | "declaredUnitPrice" | "hsCode" | "productNature" | "channel";

/** [字段, 模板表头, 其他可识别的表头写法, 是否必填] */
const COLUMNS: [Field, string, RegExp, boolean][] = [
  ["customerRef", "订单号", /^(订单号|客户单号|order.?(no|number|id)|reference|ref)$/i, false],
  ["nameFirst", "收件人名", /^(收件人名|名|first.?name)$/i, true],
  ["nameLast", "收件人姓", /^(收件人姓|姓|last.?name)$/i, true],
  ["phone", "电话", /^(电话|收件人电话|phone|tel)$/i, false],
  ["email", "邮箱", /^(邮箱|email)$/i, false],
  ["corporateName", "公司", /^(公司|company)$/i, false],
  ["country", "国家", /^(国家|国家代码|country)$/i, false],
  ["province", "州", /^(州|州\/省|省|state|province)$/i, false],
  ["city", "城市", /^(城市|city)$/i, true],
  ["zipCode", "邮编", /^(邮编|zip|zip.?code|postal.?code|postcode)$/i, true],
  ["address1", "地址1", /^(地址1|地址|address.?1|address|street)$/i, true],
  ["address2", "地址2", /^(地址2|address.?2)$/i, false],
  ["length", "长", /^(长|length)$/i, true],
  ["width", "宽", /^(宽|width)$/i, true],
  ["height", "高", /^(高|height)$/i, true],
  ["weight", "重量", /^(重量|weight)$/i, true],
  ["unit", "单位", /^(单位|unit)$/i, false],
  ["sign", "签名服务", /^(签名|签名服务|signature)$/i, false],
  ["sku", "SKU", /^(sku)$/i, true],
  ["productNameCn", "中文品名", /^(中文品名|品名|name.?cn)$/i, true],
  ["productNameEn", "英文品名", /^(英文品名|name.?en|description)$/i, true],
  ["quantity", "数量", /^(数量|qty|quantity)$/i, true],
  ["declaredUnitPrice", "申报单价", /^(申报单价|申报价值|单价|declared.?(value|price)|unit.?price|value)$/i, true],
  ["hsCode", "海关编码", /^(海关编码|hs.?code|hs)$/i, true],
  ["productNature", "商品性质", /^(商品性质|nature)$/i, false],
  ["channel", "渠道代码", /^(渠道|渠道代码|channel)$/i, false],
];

const TEMPLATE_NOTES: Record<Field, string> = {
  customerRef: "可选。同一个订单号的多行合并成一单（多个 SKU）",
  nameFirst: "必填", nameLast: "必填", phone: "", email: "", corporateName: "",
  country: "二字码，默认 US", province: "例如 CA", city: "必填", zipCode: "必填", address1: "必填", address2: "",
  length: "必填", width: "必填", height: "必填", weight: "必填（整个包裹）",
  unit: "lb/in（默认）、kg/cm 或 g/cm", sign: "0 不需要（默认）1 直接 2 间接 3 成人",
  sku: "必填", productNameCn: "必填", productNameEn: "必填", quantity: "必填", declaredUnitPrice: "必填，USD",
  hsCode: "必填", productNature: "1带磁 2不带磁 3带电 4不带电 5液体，默认 2,4", channel: "可选，留空按页面选择",
};

export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("订单");
  ws.addRow(COLUMNS.map((c) => (c[3] ? `${c[1]}*` : c[1])));
  ws.addRow(["A1001", "John", "Doe", "5125550100", "", "", "US", "TX", "Austin", "78701", "500 Congress Ave", "", 10, 8, 4, 2, "lb/in", 0, "TS-001", "T恤", "Cotton T-shirt", 2, 8, "610910", "2,4", ""]);
  ws.addRow(["A1001", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "CAP-02", "帽子", "Baseball cap", 1, 5, "650500", "2,4", ""]);
  ws.addRow(["A1002", "Mary", "Smith", "", "", "", "US", "CA", "Los Angeles", "90001", "123 Main St", "Apt 4", 12, 9, 5, 3.5, "lb/in", 0, "BAG-01", "背包", "Backpack", 1, 20, "420292", "2,4", ""]);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((col, i) => (col.width = Math.max(10, COLUMNS[i][1].length * 2 + 4)));
  const help = wb.addWorksheet("说明");
  help.addRow(["列", "说明"]).font = { bold: true };
  COLUMNS.forEach(([f, h]) => help.addRow([h, TEMPLATE_NOTES[f]]));
  help.addRow([]);
  help.addRow(["提示", "带 * 为必填。同一订单号的第 2 行起只需填写 SKU 相关列。示例数据请删除后再填写。"]);
  help.getColumn(1).width = 14;
  help.getColumn(2).width = 60;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ---------------- 解析 ---------------- */

export interface ParsedOrder {
  rowNo: number;
  customerRef: string;
  req: ShipmentRequest;
  channel: string;
  errors: string[];
}

function norm(h: string) {
  return (h ?? "").replace(/[*＊\s]/g, "").replace(/（.*?）|\(.*?\)/g, "");
}

function mapHeader(header: string[]): Partial<Record<Field, number>> {
  const map: Partial<Record<Field, number>> = {};
  header.forEach((h, i) => {
    const n = norm(h);
    const col = COLUMNS.find(([f, label, re]) => map[f] === undefined && (n === label || re.test(n)));
    if (col) map[col[0]] = i;
  });
  return map;
}

function parseUnit(v: string, def: UnitSystem): UnitSystem {
  const s = v.toLowerCase();
  if (!s) return def;
  if (/kg/.test(s)) return 2;
  if (/^g|g\/cm|克/.test(s)) return 1;
  if (/lb|in|英/.test(s)) return 3;
  return def;
}

function parseSign(v: string): 0 | 1 | 2 | 3 {
  if (/成人|adult|3/i.test(v)) return 3;
  if (/间接|indirect|2/i.test(v)) return 2;
  if (/直接|direct|1/i.test(v)) return 1;
  return 0;
}

const num = (v: string | undefined) => {
  const n = parseFloat((v ?? "").replace(/[,，\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export function parseOrders(rows: string[][], sender: Address | null): { orders: ParsedOrder[]; error?: string } {
  const st = getSettings();
  let headerIdx = -1;
  let map: Partial<Record<Field, number>> = {};
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const m = mapHeader(rows[i]);
    if (Object.keys(m).length >= 6) {
      headerIdx = i;
      map = m;
      break;
    }
  }
  if (headerIdx < 0) return { orders: [], error: "没有找到表头，请使用系统提供的模板" };
  const missing = COLUMNS.filter(([f, , , req]) => req && map[f] === undefined).map(([, h]) => h);
  if (missing.length) return { orders: [], error: `表格缺少必填列：${missing.join("、")}` };

  const get = (r: string[], f: Field) => (map[f] === undefined ? "" : (r[map[f]!] ?? "").trim());
  const orders: ParsedOrder[] = [];
  const byRef = new Map<string, ParsedOrder>();

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.some((c) => c && c.trim())) continue;
    const ref = get(r, "customerRef");
    const unit = parseUnit(get(r, "unit"), st.defaultUnit);
    const sku: SkuItem = {
      sku: get(r, "sku"),
      productNameCn: get(r, "productNameCn"),
      productNameEn: get(r, "productNameEn"),
      quantity: Math.round(num(get(r, "quantity"))),
      declaredUnitPrice: num(get(r, "declaredUnitPrice")),
      declaredCurrency: st.defaultCurrency,
      hsCode: get(r, "hsCode"),
      productNature: get(r, "productNature") || "2,4",
      length: 0, width: 0, height: 0, weight: 0, unit,
    };
    const existing = ref ? byRef.get(ref) : undefined;
    if (existing) {
      existing.req.skuList.push({ ...sku, unit: existing.req.pkg.displayUnitSystem });
      continue;
    }
    const recipient: Address = {
      nameFirst: get(r, "nameFirst"),
      nameLast: get(r, "nameLast"),
      country: (get(r, "country") || "US").toUpperCase(),
      city: get(r, "city"),
      address1: get(r, "address1"),
      zipCode: get(r, "zipCode"),
    };
    for (const k of ["phone", "email", "corporateName", "province", "address2"] as const) {
      const v = get(r, k);
      if (v) recipient[k] = v;
    }
    const order: ParsedOrder = {
      rowNo: i + 1,
      customerRef: ref,
      channel: get(r, "channel"),
      errors: [],
      req: {
        sender: sender ?? ({} as Address),
        recipient,
        pkg: {
          length: num(get(r, "length")),
          width: num(get(r, "width")),
          height: num(get(r, "height")),
          weight: num(get(r, "weight")),
          displayUnitSystem: unit,
          signServiceType: parseSign(get(r, "sign")),
          insuranceService: 0,
          currency: st.defaultCurrency,
        },
        skuList: [sku],
      },
    };
    orders.push(order);
    if (ref) byRef.set(ref, order);
  }

  for (const o of orders) {
    // SKU 尺寸/重量用包裹数据按数量均摊（接口要求必填）
    const { pkg } = o.req;
    const totalQty = o.req.skuList.reduce((a, s) => a + (s.quantity || 1), 0) || 1;
    o.req.skuList = o.req.skuList.map((s) => ({
      ...s,
      length: pkg.length,
      width: pkg.width,
      height: pkg.height,
      weight: Math.round((pkg.weight / totalQty) * 1000) / 1000,
      unit: pkg.displayUnitSystem,
    }));
    if (!sender) o.errors.push("没有默认寄件地址，请先在账户设置里填写");
    o.errors.push(...validateRequest(o.req).filter((e) => !e.startsWith("寄件人") || sender));
  }
  if (!orders.length) return { orders, error: "表格里没有订单数据" };
  if (orders.length > 500) return { orders: [], error: "一次最多 500 单，请分批上传" };
  return { orders };
}

/* ---------------- 任务 ---------------- */

export type RowStatus = "pending" | "quoted" | "error" | "created" | "failed";


export interface BatchJob {
  id: number;
  customerId: number;
  customerName: string;
  createdBy: string;
  filename: string | null;
  channelMode: string;
  status: JobStatus;
  error: string | null;
  createdAt: string;
  rows: BatchRow[];
}

export interface BatchRow {
  id: number;
  rowNo: number;
  customerRef: string | null;
  recipient: string;
  channelCode: string | null;
  channelName: string | null;
  price: number | null;
  currency: string | null;
  status: RowStatus;
  error: string | null;
  shipmentId: number | null;
  trackingNo: string | null;
  hasLabel: boolean;
}

export function createJob(input: {
  customerId: number;
  createdBy: "admin" | "customer";
  filename: string;
  channelMode: string;
  orders: ParsedOrder[];
}): number {
  return db().transaction(() => {
    const r = db()
      .prepare("INSERT INTO batch_jobs (customer_id, created_by, filename, channel_mode, status) VALUES (?,?,?,?, 'quoting')")
      .run(input.customerId, input.createdBy, input.filename, input.channelMode);
    const jobId = Number(r.lastInsertRowid);
    const stmt = db().prepare(
      "INSERT INTO batch_job_rows (job_id, row_no, customer_ref, req_json, channel_code, status, error) VALUES (?,?,?,?,?,?,?)",
    );
    for (const o of input.orders) {
      stmt.run(jobId, o.rowNo, o.customerRef || null, JSON.stringify(o.req), o.channel || null, o.errors.length ? "error" : "pending", o.errors.join("；") || null);
    }
    return jobId;
  })();
}

interface JobRowDb {
  id: number;
  job_id: number;
  row_no: number;
  customer_ref: string | null;
  req_json: string;
  channel_code: string | null;
  channel_name: string | null;
  price: number | null;
  currency: string | null;
  status: RowStatus;
  error: string | null;
  shipment_id: number | null;
}

function jobRows(jobId: number): JobRowDb[] {
  return db().prepare("SELECT * FROM batch_job_rows WHERE job_id = ? ORDER BY row_no").all(jobId) as JobRowDb[];
}

function setJob(jobId: number, status: JobStatus, error: string | null = null) {
  db().prepare("UPDATE batch_jobs SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ?").run(status, error, jobId);
}

function setRow(id: number, p: Partial<Pick<JobRowDb, "channel_code" | "channel_name" | "price" | "currency" | "status" | "error" | "shipment_id">>) {
  const keys = Object.keys(p);
  if (!keys.length) return;
  db()
    .prepare(`UPDATE batch_job_rows SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...keys.map((k) => (p as Record<string, unknown>)[k] as string | number | null), id);
}

export function getJob(jobId: number): BatchJob | null {
  const j = db()
    .prepare("SELECT j.*, c.name AS customer_name FROM batch_jobs j JOIN customers c ON c.id = j.customer_id WHERE j.id = ?")
    .get(jobId) as
    | { id: number; customer_id: number; customer_name: string; created_by: string; filename: string | null; channel_mode: string; status: JobStatus; error: string | null; created_at: string }
    | undefined;
  if (!j) return null;
  return {
    id: j.id,
    customerId: j.customer_id,
    customerName: j.customer_name,
    createdBy: j.created_by,
    filename: j.filename,
    channelMode: j.channel_mode,
    status: j.status,
    error: j.error,
    createdAt: j.created_at,
    rows: jobRows(jobId).map((r) => {
      const req = JSON.parse(r.req_json) as ShipmentRequest;
      const s = r.shipment_id ? getShipment(r.shipment_id) : null;
      return {
        id: r.id,
        rowNo: r.row_no,
        customerRef: r.customer_ref,
        recipient: `${req.recipient.nameFirst} ${req.recipient.nameLast}, ${req.recipient.city} ${req.recipient.province ?? ""} ${req.recipient.zipCode}`,
        channelCode: r.channel_code,
        channelName: r.channel_name,
        price: r.price,
        currency: r.currency,
        status: r.status,
        error: r.error,
        shipmentId: r.shipment_id,
        trackingNo: s?.trackingNo ?? null,
        hasLabel: !!s?.labelPath,
      };
    }),
  };
}

export function listJobs(customerId?: number, limit = 20) {
  return db()
    .prepare(
      `SELECT j.id, j.filename, j.status, j.created_at, j.created_by, c.name AS customer_name,
        (SELECT COUNT(*) FROM batch_job_rows r WHERE r.job_id = j.id) AS total,
        (SELECT COUNT(*) FROM batch_job_rows r WHERE r.job_id = j.id AND r.status = 'created') AS created
       FROM batch_jobs j JOIN customers c ON c.id = j.customer_id
       ${customerId ? "WHERE j.customer_id = ?" : ""} ORDER BY j.id DESC LIMIT ${Number(limit)}`,
    )
    .all(...(customerId ? [customerId] : [])) as {
    id: number; filename: string | null; status: JobStatus; created_at: string; created_by: string; customer_name: string; total: number; created: number;
  }[];
}

export function deleteJob(jobId: number) {
  const j = getJob(jobId);
  if (!j) return;
  if (j.status === "creating" || j.status === "labeling") throw new Error("任务正在下单，不能删除");
  if (j.rows.some((r) => r.status === "created")) throw new Error("任务里已有订单下单成功，不能删除");
  db().prepare("DELETE FROM batch_jobs WHERE id = ?").run(jobId);
}

/* ---------------- 后台执行 ---------------- */

const g = globalThis as unknown as { __batchRunning?: Set<number> };
const running = (g.__batchRunning ??= new Set<number>());

/** 启动（或继续）一个任务的后台处理。重复调用是安全的。 */
export function ensureRunning(jobId: number) {
  const j = getJob(jobId);
  if (!j || running.has(jobId)) return;
  if (j.status === "quoting") run(jobId, quoteJob);
  else if (j.status === "creating") run(jobId, createJobLabels);
  else if (j.status === "labeling") run(jobId, waitLabels);
}

function run(jobId: number, fn: (jobId: number) => Promise<void>) {
  running.add(jobId);
  fn(jobId)
    .catch((e) => setJob(jobId, "ready", `处理出错：${(e as Error).message}`))
    .finally(() => running.delete(jobId));
}

async function pool<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x);
  }));
}

async function quoteJob(jobId: number) {
  const job = getJob(jobId)!;
  const enabled = listChannels(true);
  const pending = jobRows(jobId).filter((r) => r.status === "pending");
  await pool(pending, 3, async (r) => {
    const req = JSON.parse(r.req_json) as ShipmentRequest;
    const code = r.channel_code || (job.channelMode !== "cheapest" ? job.channelMode : "");
    try {
      if (code) {
        if (!enabled.some((c) => c.code === code)) {
          setRow(r.id, { status: "error", error: `渠道 ${code} 不存在或未开放` });
          return;
        }
        const q = await quoteChannel(job.customerId, code, req);
        if (q.ok) setRow(r.id, { status: "quoted", channel_code: q.channelCode, channel_name: q.channelName, price: q.price!, currency: q.currency!, error: null });
        else setRow(r.id, { status: "error", error: `无法报价：${q.error}` });
        return;
      }
      const all = await quoteAll(job.customerId, req);
      const best = all.filter((q) => q.ok).sort((a, b) => a.price! - b.price!)[0];
      if (best) setRow(r.id, { status: "quoted", channel_code: best.channelCode, channel_name: best.channelName, price: best.price!, currency: best.currency!, error: null });
      else setRow(r.id, { status: "error", error: `无法报价：${all[0]?.error ?? "没有可用渠道"}` });
    } catch (e) {
      setRow(r.id, { status: "error", error: (e as Error).message });
    }
  });
  setJob(jobId, "ready");
}

/** 确认下单 */
export function confirmJob(jobId: number) {
  const j = getJob(jobId);
  if (!j) throw new Error("任务不存在");
  if (j.status !== "ready") throw new Error("任务当前不能下单");
  if (!j.rows.some((r) => r.status === "quoted")) throw new Error("没有可以下单的订单");
  setJob(jobId, "creating");
  ensureRunning(jobId);
}

async function createJobLabels(jobId: number) {
  const job = getJob(jobId)!;
  const rows = jobRows(jobId).filter((r) => r.status === "quoted");
  let stopped: string | null = null;
  let priceChanged = 0;
  // 逐单下单：钱包扣款要按顺序，不并发
  for (const r of rows) {
    if (stopped) break;
    const req = JSON.parse(r.req_json) as ShipmentRequest;
    const channel = getChannel(r.channel_code!);
    if (!channel?.enabled) {
      setRow(r.id, { status: "failed", error: "渠道已停用" });
      continue;
    }
    try {
      const id = await createLabel({
        customerId: job.customerId,
        channelCode: r.channel_code!,
        req,
        expectedPrice: r.price!,
        customerRef: r.customer_ref ?? undefined,
        createdBy: job.createdBy === "customer" ? "customer" : "admin",
        waitForLabel: false,
      });
      setRow(r.id, { status: "created", shipment_id: id, error: null });
    } catch (e) {
      if (e instanceof InsufficientBalanceError) {
        stopped = `余额不足，已暂停。充值后点“继续下单”。（${e.message}）`;
      } else if (e instanceof PriceChangedError) {
        priceChanged++;
        setRow(r.id, { price: e.quote.price!, error: `运费已更新为 ${e.quote.price!.toFixed(2)}，请确认后继续` });
      } else {
        setRow(r.id, { status: "failed", error: (e as Error).message });
      }
    }
  }
  if (stopped || priceChanged) {
    setJob(jobId, "ready", stopped ?? `${priceChanged} 单运费有变化，请确认后点“继续下单”`);
    return;
  }
  setJob(jobId, "labeling");
  await waitLabels(jobId);
}

async function waitLabels(jobId: number) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const pending = jobRows(jobId)
      .filter((r) => r.status === "created" && r.shipment_id)
      .map((r) => getShipment(r.shipment_id!)!)
      .filter((s) => s && s.status === "pending");
    if (!pending.length) break;
    await pool(pending, 3, async (s) => {
      await refreshShipment(s.id).catch(() => null);
    });
    await new Promise((r) => setTimeout(r, 2000));
  }
  setJob(jobId, "done");
}

/** 任务所属客户的默认寄件地址 */
export function senderFor(customerId: number): Address | null {
  return getCustomer(customerId)?.sender ?? getSettings().sender;
}
