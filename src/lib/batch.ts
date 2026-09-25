/**
 * 批量下单（和 ShipBest 后台的“导入订单 → 运费试算 → 提交订单”一致）：
 * 上传 ShipBest 标准导单模板 → 每单按所选渠道逐个试算 → 每单默认选最便宜（可改）→ 勾选订单提交 → 刷新面单 → 合并打印。
 * 任务在服务进程里后台执行，页面轮询进度；服务重启后打开任务页会自动继续。
 */
import ExcelJS from "exceljs";
import { db, getChannel, getCustomer, getSettings, getShipment, listChannels } from "./db";
import { InsufficientBalanceError } from "./ledger";
import { createLabel, PriceChangedError, quoteChannel, refreshShipment, validateRequest } from "./service";
import type { Address, ShipmentRequest, SkuItem, UnitSystem } from "./shipbest/types";
import { JOB_STATUS_LABEL, type JobStatus } from "./batchLabels";

export { JOB_STATUS_LABEL, type JobStatus };

/* ---------------- 模板（ShipBest 标准导单模板，55 列） ---------------- */

/** 表头顺序与 ShipBest 后台“导入订单”模板完全一致，客户可以直接用原来的表 */
export const SHIPBEST_HEADERS = [
  "*自定义单号", "*物流产品", "*保险服务", "保险金额", "*签名服务", "*包裹长", "*包裹宽", "*包裹高", "*包裹重量", "*包裹单位", "备注",
  "*SKU", "*品名(中文)", "*品名(英文)", "*数量", "*申报单价", "*单件重量", "*SKU单位", "SKU长", "SKU宽", "SKU高", "HS CODE", "商品性质",
  "*收件联系人姓", "*收件联系人名", "*收件人联系电话", "*收件国家", "*收件省州", "*收件市府", "收件地区", "*收件邮编", "收件邮箱", "*收件地址1", "收件地址2", "公司名称", "街道", "门牌号", "税号",
  "*寄件联系人姓", "*寄件联系人名", "*寄件人联系电话", "*寄件国家", "*寄件省州", "*寄件市府", "寄件地区", "*寄件邮编", "寄件邮箱", "*寄件地址1", "寄件地址2", "公司名称", "街道", "门牌号", "税号",
  "申报总金额", "申报总数量",
];

export async function buildTemplate(sender?: Address | null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("导入模板");
  ws.addRow(SHIPBEST_HEADERS);
  const s = sender;
  const senderCols = s
    ? [s.nameLast, s.nameFirst, s.phone ?? "", s.country, s.province ?? "", s.city, s.area ?? "", s.zipCode, s.email ?? "", s.address1, s.address2 ?? "", s.corporateName ?? "", "", "", ""]
    : Array(15).fill("");
  const recip = (last: string, first: string, phone: string, st: string, city: string, zip: string, a1: string, a2 = "") =>
    [last, first, phone, "US", st, city, "", zip, "", a1, a2, "", "", "", ""];
  // 示例：A1001 两个 SKU（第二行自定义单号留空），A1002 一个 SKU
  ws.addRow(["A1001", "", "不需要", "", "不需要", 25, 20, 10, 900, "cm/g", "", "TS-001", "T恤", "T-shirt", 2, 8, 300, "cm/g", "", "", "", "610910", "", ...recip("Doe", "John", "512-555-0100", "TX", "Austin", "78701", "500 Congress Ave"), ...senderCols]);
  ws.addRow(["", "", "", "", "", "", "", "", "", "", "", "CAP-02", "帽子", "Cap", 1, 5, 150, "cm/g"]);
  ws.addRow(["A1002", "", "不需要", "", "不需要", 12, 9, 5, 3.5, "in/lb", "", "BAG-01", "背包", "Backpack", 1, 20, 3.5, "in/lb", "", "", "", "", "", ...recip("Smith", "Mary", "213-555-0199", "CA", "Los Angeles", "90001", "123 Main St", "Apt 4"), ...senderCols]);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => (c.width = 14));

  const help = wb.addWorksheet("说明");
  const notes: [string, string][] = [
    ["格式", "与 ShipBest 后台“导入订单”模板相同，原来的表格可以直接上传。带 * 为必填。"],
    ["多个 SKU", "同一个订单有多个 SKU 时，第 2 行起“自定义单号”留空，只填 SKU 相关列。"],
    ["物流产品", "可以留空。上传后系统会用多个渠道试算，每单默认选最便宜的，也可以按表格里的物流产品。"],
    ["包裹单位", "cm/g、cm/kg 或 in/lb。SKU 单位同理。"],
    ["保险 / 签名", "保险服务：需要 / 不需要；签名服务：不需要 / 直接签名 / 间接签名 / 成人签名。"],
    ["寄件人", "寄件人各列可以留空，留空时使用账户里的默认寄件地址。"],
    ["商品性质", "1 带磁 2 不带磁 3 带电 4 不带电 5 液体，多个用逗号分隔；留空默认 2,4。"],
    ["示例", "“导入模板”里的 3 行是示例（2 个订单），请删除后填写自己的订单。"],
  ];
  help.addRow(["项目", "说明"]).font = { bold: true };
  notes.forEach((n) => help.addRow(n));
  help.getColumn(1).width = 14;
  help.getColumn(2).width = 90;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ---------------- 解析 ---------------- */

export interface ParsedOrder {
  rowNo: number;
  customerRef: string;
  req: ShipmentRequest;
  /** 表格里填写的物流产品（渠道名称或代码） */
  fileChannel: string;
  errors: string[];
}

const norm = (h: string) => (h ?? "").replace(/[*＊\s]/g, "").replace(/（/g, "(").replace(/）/g, ")").toLowerCase();

const num = (v: string | undefined) => {
  const n = parseFloat((v ?? "").replace(/[,，\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function parseUnit(v: string, def: UnitSystem): UnitSystem {
  const s = (v ?? "").toLowerCase().replace(/\s/g, "");
  if (!s) return def;
  if (/in|lb|英/.test(s)) return 3;
  if (/kg/.test(s)) return 2;
  if (/g/.test(s)) return 1;
  return def;
}

function parseSign(v: string): 0 | 1 | 2 | 3 {
  if (/成人|adult|^3$/i.test(v)) return 3;
  if (/间接|indirect|^2$/i.test(v)) return 2;
  if (/直接|direct|^1$/i.test(v)) return 1;
  return 0;
}

/** 表头 → 列号。同名列（公司名称、街道…）按收件 / 寄件区块区分 */
function headerIndex(header: string[]) {
  const h = header.map(norm);
  const senderStart = h.findIndex((x) => x.startsWith("寄件联系人姓"));
  const recipStart = h.findIndex((x) => x.startsWith("收件联系人姓"));
  const find = (name: string, from = 0, to = h.length) => {
    const n = norm(name);
    for (let i = Math.max(0, from); i < to; i++) if (h[i] === n) return i;
    return -1;
  };
  const inRecip = (name: string) => find(name, recipStart, senderStart > recipStart ? senderStart : h.length);
  const inSender = (name: string) => (senderStart >= 0 ? find(name, senderStart) : -1);
  return { find, inRecip, inSender, senderStart };
}

export function isShipBestTemplate(header: string[]) {
  const h = header.map(norm);
  return h.includes("自定义单号") && h.some((x) => x.startsWith("收件联系人姓"));
}

export function parseOrders(rows: string[][], defaultSender: Address | null): { orders: ParsedOrder[]; error?: string } {
  const st = getSettings();
  const headerIdx = rows.slice(0, 10).findIndex(isShipBestTemplate);
  if (headerIdx < 0) return { orders: [], error: "没有找到表头，请使用 ShipBest 导单模板（或在本页下载模板）" };
  const { find, inRecip, inSender, senderStart } = headerIndex(rows[headerIdx]);
  const col = {
    ref: find("自定义单号"), channel: find("物流产品"), ins: find("保险服务"), insFee: find("保险金额"), sign: find("签名服务"),
    len: find("包裹长"), wid: find("包裹宽"), hei: find("包裹高"), wt: find("包裹重量"), unit: find("包裹单位"),
    sku: find("SKU"), cn: find("品名(中文)"), en: find("品名(英文)"), qty: find("数量"), price: find("申报单价"),
    skuWt: find("单件重量"), skuUnit: find("SKU单位"), skuLen: find("SKU长"), skuWid: find("SKU宽"), skuHei: find("SKU高"),
    hs: find("HS CODE"), nature: find("商品性质"),
  };
  const missing = Object.entries({ 自定义单号: col.ref, 包裹重量: col.wt, SKU: col.sku }).filter(([, i]) => i < 0).map(([k]) => k);
  if (missing.length) return { orders: [], error: `表格缺少必填列：${missing.join("、")}` };

  const addr = (r: string[], pick: (n: string) => number, prefix: "收件" | "寄件"): Address => {
    const g = (n: string) => {
      const i = pick(n);
      return i >= 0 ? (r[i] ?? "").trim() : "";
    };
    const a: Address = {
      nameLast: g(`${prefix}联系人姓`),
      nameFirst: g(`${prefix}联系人名`),
      country: (g(`${prefix}国家`) || "US").toUpperCase(),
      city: g(`${prefix}市府`),
      address1: g(`${prefix}地址1`),
      zipCode: g(`${prefix}邮编`),
    };
    const opt: [keyof Address, string][] = [
      ["phone", prefix === "收件" ? "收件人联系电话" : "寄件人联系电话"], ["province", `${prefix}省州`], ["area", `${prefix}地区`],
      ["email", `${prefix}邮箱`], ["address2", `${prefix}地址2`], ["corporateName", "公司名称"], ["street", "街道"],
      ["houseNumber", "门牌号"], ["taxIdValue", "税号"],
    ];
    for (const [k, n] of opt) {
      const v = g(n);
      if (v) a[k] = v as never;
    }
    return a;
  };

  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const orders: ParsedOrder[] = [];
  let current: ParsedOrder | null = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.some((c) => c && c.trim())) continue;
    const ref = get(r, col.ref);
    const skuCode = get(r, col.sku);
    const skuUnit = parseUnit(get(r, col.skuUnit) || get(r, col.unit), st.defaultUnit);
    const sku: SkuItem = {
      sku: skuCode,
      productNameCn: get(r, col.cn),
      productNameEn: get(r, col.en),
      quantity: Math.round(num(get(r, col.qty))),
      declaredUnitPrice: num(get(r, col.price)),
      declaredCurrency: st.defaultCurrency,
      hsCode: get(r, col.hs),
      productNature: get(r, col.nature) || "2,4",
      length: num(get(r, col.skuLen)),
      width: num(get(r, col.skuWid)),
      height: num(get(r, col.skuHei)),
      weight: num(get(r, col.skuWt)),
      unit: skuUnit,
    };
    // 自定义单号为空、只有 SKU 的行：属于上一单
    if (!ref) {
      if (current && skuCode) current.req.skuList.push(sku);
      continue;
    }
    const fileSender = senderStart >= 0 ? addr(r, inSender, "寄件") : null;
    const sender = fileSender && fileSender.nameFirst && fileSender.address1 && fileSender.zipCode ? fileSender : defaultSender;
    const insurance = /^需要|^是|yes|^1$/i.test(get(r, col.ins)) ? 1 : 0;
    current = {
      rowNo: i + 1,
      customerRef: ref,
      fileChannel: get(r, col.channel),
      errors: [],
      req: {
        sender: sender ?? ({} as Address),
        recipient: addr(r, inRecip, "收件"),
        pkg: {
          length: num(get(r, col.len)),
          width: num(get(r, col.wid)),
          height: num(get(r, col.hei)),
          weight: num(get(r, col.wt)),
          displayUnitSystem: parseUnit(get(r, col.unit), st.defaultUnit),
          signServiceType: parseSign(get(r, col.sign)),
          insuranceService: insurance as 0 | 1,
          insuranceFee: insurance ? num(get(r, col.insFee)) : undefined,
          currency: st.defaultCurrency,
        },
        skuList: skuCode ? [sku] : [],
      },
    };
    if (!sender) current.errors.push("没有寄件地址：表格里没填，账户里也没有默认寄件地址");
    orders.push(current);
  }

  for (const o of orders) {
    const { pkg } = o.req;
    // SKU 尺寸没填时用包裹尺寸（接口要求必填）；单件重量没填时按包裹重量均摊
    const totalQty = o.req.skuList.reduce((a, s) => a + (s.quantity || 1), 0) || 1;
    o.req.skuList = o.req.skuList.map((s) => ({
      ...s,
      length: s.length || pkg.length,
      width: s.width || pkg.width,
      height: s.height || pkg.height,
      ...(s.weight ? {} : { weight: Math.round((pkg.weight / totalQty) * 1000) / 1000, unit: pkg.displayUnitSystem }),
    }));
    o.errors.push(...validateRequest(o.req).filter((e) => o.req.sender.nameFirst || !e.startsWith("寄件人")));
  }
  const refs = new Map<string, number>();
  for (const o of orders) refs.set(o.customerRef, (refs.get(o.customerRef) ?? 0) + 1);
  for (const o of orders) if (refs.get(o.customerRef)! > 1) o.errors.push("表格里自定义单号重复");
  if (!orders.length) return { orders, error: "表格里没有订单数据" };
  if (orders.length > 500) return { orders: [], error: "一次最多 500 单，请分批上传" };
  return { orders };
}

/** 表格里的物流产品名称 → 渠道代码（按名称或代码匹配，忽略空格和全半角括号） */
export function matchChannel(name: string): string | null {
  if (!name) return null;
  const n = norm(name);
  const c = listChannels(true).find((ch) => norm(ch.name) === n || norm(ch.code) === n);
  return c?.code ?? null;
}

/* ---------------- 任务 ---------------- */

export type RowStatus = "pending" | "quoted" | "error" | "created" | "failed";

/** 某一单在某个渠道的试算结果（只有客户价，没有成本） */
export interface RowQuote {
  code: string;
  name: string;
  ok: boolean;
  price?: number;
  currency?: string;
  zone?: string | null;
  error?: string;
}

/** cheapest = 每单选最便宜；file = 优先用表格里的物流产品 */
export type PickMode = "cheapest" | "file";

export interface BatchJob {
  id: number;
  customerId: number;
  customerName: string;
  createdBy: string;
  filename: string | null;
  status: JobStatus;
  error: string | null;
  createdAt: string;
  /** 本次试算的渠道 */
  channels: { code: string; name: string }[];
  pickMode: PickMode;
  rows: BatchRow[];
}

export interface BatchRow {
  id: number;
  rowNo: number;
  customerRef: string | null;
  recipient: string;
  pkg: string;
  fileChannel: string | null;
  quotes: RowQuote[];
  channelCode: string | null;
  channelName: string | null;
  price: number | null;
  currency: string | null;
  selected: boolean;
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
  channels: string[];
  pickMode: PickMode;
  orders: ParsedOrder[];
}): number {
  const enabled = listChannels(true).map((c) => c.code);
  const channels = input.channels.filter((c) => enabled.includes(c));
  return db().transaction(() => {
    const r = db()
      .prepare("INSERT INTO batch_jobs (customer_id, created_by, filename, channel_mode, channels_json, pick_mode, status) VALUES (?,?,?,?,?,?, 'quoting')")
      .run(input.customerId, input.createdBy, input.filename, input.pickMode, JSON.stringify(channels.length ? channels : enabled), input.pickMode);
    const jobId = Number(r.lastInsertRowid);
    const stmt = db().prepare(
      "INSERT INTO batch_job_rows (job_id, row_no, customer_ref, req_json, file_channel, status, error) VALUES (?,?,?,?,?,?,?)",
    );
    for (const o of input.orders) {
      stmt.run(jobId, o.rowNo, o.customerRef || null, JSON.stringify(o.req), o.fileChannel || null, o.errors.length ? "error" : "pending", o.errors.join("；") || null);
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
  file_channel: string | null;
  quotes_json: string | null;
  channel_code: string | null;
  channel_name: string | null;
  price: number | null;
  currency: string | null;
  selected: number;
  status: RowStatus;
  error: string | null;
  shipment_id: number | null;
}

type RowPatch = Partial<Pick<JobRowDb, "channel_code" | "channel_name" | "price" | "currency" | "status" | "error" | "shipment_id" | "quotes_json" | "selected">>;

function jobRows(jobId: number): JobRowDb[] {
  return db().prepare("SELECT * FROM batch_job_rows WHERE job_id = ? ORDER BY row_no").all(jobId) as JobRowDb[];
}

function setJob(jobId: number, status: JobStatus, error: string | null = null) {
  db().prepare("UPDATE batch_jobs SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ?").run(status, error, jobId);
}

function setRow(id: number, p: RowPatch) {
  const keys = Object.keys(p);
  if (!keys.length) return;
  db()
    .prepare(`UPDATE batch_job_rows SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...keys.map((k) => (p as Record<string, unknown>)[k] as string | number | null), id);
}

const UNIT_TXT: Record<UnitSystem, [string, string]> = { 1: ["cm", "g"], 2: ["cm", "kg"], 3: ["in", "lb"] };

export function getJob(jobId: number): BatchJob | null {
  const j = db()
    .prepare("SELECT j.*, c.name AS customer_name FROM batch_jobs j JOIN customers c ON c.id = j.customer_id WHERE j.id = ?")
    .get(jobId) as
    | { id: number; customer_id: number; customer_name: string; created_by: string; filename: string | null; channels_json: string | null; pick_mode: PickMode; status: JobStatus; error: string | null; created_at: string }
    | undefined;
  if (!j) return null;
  const codes: string[] = j.channels_json ? JSON.parse(j.channels_json) : listChannels(true).map((c) => c.code);
  return {
    id: j.id,
    customerId: j.customer_id,
    customerName: j.customer_name,
    createdBy: j.created_by,
    filename: j.filename,
    status: j.status,
    error: j.error,
    createdAt: j.created_at,
    pickMode: j.pick_mode ?? "cheapest",
    channels: codes.map((code) => ({ code, name: getChannel(code)?.name ?? code })),
    rows: jobRows(jobId).map((r) => {
      const req = JSON.parse(r.req_json) as ShipmentRequest;
      const s = r.shipment_id ? getShipment(r.shipment_id) : null;
      const [lu, wu] = UNIT_TXT[req.pkg.displayUnitSystem] ?? UNIT_TXT[3];
      return {
        id: r.id,
        rowNo: r.row_no,
        customerRef: r.customer_ref,
        recipient: `${req.recipient.nameFirst} ${req.recipient.nameLast}, ${req.recipient.city} ${req.recipient.province ?? ""} ${req.recipient.zipCode}`,
        pkg: `${req.pkg.length}×${req.pkg.width}×${req.pkg.height} ${lu} · ${req.pkg.weight} ${wu}`,
        fileChannel: r.file_channel,
        quotes: r.quotes_json ? JSON.parse(r.quotes_json) : [],
        channelCode: r.channel_code,
        channelName: r.channel_name,
        price: r.price,
        currency: r.currency,
        selected: !!r.selected,
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

/* ---------------- 选择渠道 / 勾选（任务处于“待确认”时） ---------------- */

function assertEditable(jobId: number) {
  const j = getJob(jobId);
  if (!j) throw new Error("任务不存在");
  if (j.status !== "ready") throw new Error("任务正在处理中，请稍后再改");
  return j;
}

function applyQuote(rowId: number, q: RowQuote) {
  setRow(rowId, { channel_code: q.code, channel_name: q.name, price: q.price!, currency: q.currency ?? null, error: null });
}

/** 按规则选渠道：cheapest 最便宜 / file 表格指定（没有则最便宜）/ 具体渠道代码 */
function pickFor(quotes: RowQuote[], rule: string, fileChannel: string | null): RowQuote | undefined {
  const ok = quotes.filter((q) => q.ok).sort((a, b) => a.price! - b.price!);
  if (rule === "cheapest") return ok[0];
  if (rule === "file") {
    const code = fileChannel ? matchChannel(fileChannel) : null;
    return ok.find((q) => q.code === code) ?? ok[0];
  }
  return ok.find((q) => q.code === rule);
}

/** 单独改某一单的渠道 */
export function chooseRowChannel(jobId: number, rowId: number, code: string) {
  assertEditable(jobId);
  const r = jobRows(jobId).find((x) => x.id === rowId);
  if (!r || r.status !== "quoted") throw new Error("这一单不能修改");
  const q = (JSON.parse(r.quotes_json ?? "[]") as RowQuote[]).find((x) => x.code === code && x.ok);
  if (!q) throw new Error("该渠道没有报价");
  applyQuote(r.id, q);
}

/** 批量改渠道，返回改成功和无法改（该渠道没报价）的数量 */
export function chooseAll(jobId: number, rule: string, rowIds?: number[]) {
  assertEditable(jobId);
  let changed = 0;
  let skipped = 0;
  for (const r of jobRows(jobId)) {
    if (r.status !== "quoted" || (rowIds && !rowIds.includes(r.id))) continue;
    const q = pickFor(JSON.parse(r.quotes_json ?? "[]"), rule, r.file_channel);
    if (q) {
      applyQuote(r.id, q);
      changed++;
    } else skipped++;
  }
  return { changed, skipped };
}

export function setSelected(jobId: number, rowIds: number[] | "all" | "none") {
  assertEditable(jobId);
  for (const r of jobRows(jobId)) {
    if (r.status !== "quoted") continue;
    const sel = rowIds === "all" ? 1 : rowIds === "none" ? 0 : rowIds.includes(r.id) ? 1 : 0;
    setRow(r.id, { selected: sel });
  }
}

/** 换一组渠道重新试算（未下单的订单） */
export function requote(jobId: number, channels: string[]) {
  assertEditable(jobId);
  const enabled = listChannels(true).map((c) => c.code);
  const list = channels.filter((c) => enabled.includes(c));
  if (!list.length) throw new Error("请至少选择一个渠道");
  db().prepare("UPDATE batch_jobs SET channels_json = ? WHERE id = ?").run(JSON.stringify(list), jobId);
  for (const r of jobRows(jobId)) {
    if (r.status === "quoted" || (r.status === "error" && r.quotes_json) || r.status === "failed") {
      setRow(r.id, { status: "pending", error: null });
    }
  }
  setJob(jobId, "quoting");
  ensureRunning(jobId);
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
  const codes = job.channels.map((c) => c.code);
  const pending = jobRows(jobId).filter((r) => r.status === "pending");
  // 每单在每个渠道试算一次；同时最多 3 个请求，避免触发频率限制
  await pool(pending, 3, async (r) => {
    const req = JSON.parse(r.req_json) as ShipmentRequest;
    const quotes: RowQuote[] = [];
    for (const code of codes) {
      try {
        const q = await quoteChannel(job.customerId, code, req);
        quotes.push(q.ok
          ? { code, name: q.channelName, ok: true, price: q.price!, currency: q.currency, zone: q.zone ?? null }
          : { code, name: q.channelName, ok: false, error: q.error });
      } catch (e) {
        quotes.push({ code, name: getChannel(code)?.name ?? code, ok: false, error: (e as Error).message });
      }
    }
    quotes.sort((a, b) => Number(b.ok) - Number(a.ok) || (a.price ?? 0) - (b.price ?? 0));
    // 重新试算时尽量保留之前选的渠道
    const keep = r.channel_code ? quotes.find((q) => q.ok && q.code === r.channel_code) : undefined;
    const pick = keep ?? pickFor(quotes, job.pickMode, r.file_channel);
    if (pick) {
      setRow(r.id, { status: "quoted", quotes_json: JSON.stringify(quotes), channel_code: pick.code, channel_name: pick.name, price: pick.price!, currency: pick.currency ?? null, error: null });
    } else {
      setRow(r.id, { status: "error", quotes_json: JSON.stringify(quotes), channel_code: null, channel_name: null, price: null, error: `所有渠道都无法报价：${quotes[0]?.error ?? "没有可用渠道"}` });
    }
  });
  setJob(jobId, "ready");
}

/** 提交勾选的订单 */
export function confirmJob(jobId: number) {
  const j = getJob(jobId);
  if (!j) throw new Error("任务不存在");
  if (j.status !== "ready") throw new Error("任务当前不能下单");
  if (!j.rows.some((r) => r.status === "quoted" && r.selected && r.channelCode)) throw new Error("请勾选要提交的订单");
  setJob(jobId, "creating");
  ensureRunning(jobId);
}

async function createJobLabels(jobId: number) {
  const job = getJob(jobId)!;
  const rows = jobRows(jobId).filter((r) => r.status === "quoted" && r.selected && r.channel_code);
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
        stopped = `余额不足，已暂停。充值后点“提交订单”继续。（${e.message}）`;
      } else if (e instanceof PriceChangedError) {
        priceChanged++;
        setRow(r.id, { price: e.quote.price!, error: `运费已更新为 ${e.quote.price!.toFixed(2)}，请确认后再提交` });
      } else {
        setRow(r.id, { status: "failed", error: (e as Error).message });
      }
    }
  }
  if (stopped || priceChanged) {
    setJob(jobId, "ready", stopped ?? `${priceChanged} 单运费有变化，请确认后再点“提交订单”`);
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
  // 还有没提交的订单时回到“待确认”，可以继续提交
  const left = jobRows(jobId).some((r) => r.status === "quoted");
  setJob(jobId, left ? "ready" : "done");
}

/** 任务所属客户的默认寄件地址 */
export function senderFor(customerId: number): Address | null {
  return getCustomer(customerId)?.sender ?? getSettings().sender;
}
