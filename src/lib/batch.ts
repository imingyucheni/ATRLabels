/**
 * 批量下单（和 ShipBest 后台的“导入订单 → 运费试算 → 提交订单”一致）：
 * 上传 ShipBest 标准导单模板 → 每单按所选渠道逐个试算 → 每单默认选最便宜（可改）→ 勾选订单提交 → 刷新面单 → 合并打印。
 * 任务在服务进程里后台执行，页面轮询进度；服务重启后打开任务页会自动继续。
 */
import { publicChannel } from "./carriers";
import { checkAddress, needsAck, type AddressCheck } from "./addressCheck";
import ExcelJS from "exceljs";
import { activeShipmentByRef, customerChannels, db, duplicateRefMessage, getChannel, getCustomer, getSettings, getShipment, listChannels } from "./db";
import { InsufficientBalanceError } from "./ledger";
import { createLabel, PriceChangedError, quoteChannel, refreshShipment, validateRequest } from "./service";
import type { Address, ShipmentRequest, SkuItem, UnitSystem } from "./shipbest/types";
import { JOB_STATUS_LABEL, type JobStatus } from "./batchLabels";

export { JOB_STATUS_LABEL, type JobStatus };

/* ---------------- 模板（ShipBest 标准导单模板，55 列） ---------------- */

/** 表头顺序与 ShipBest 后台“导入订单”模板完全一致，客户可以直接用原来的表 */
export const SHIPBEST_HEADERS = [
  "*自定义单号", "物流产品", "*保险服务", "保险金额", "*签名服务", "*包裹长", "*包裹宽", "*包裹高", "*包裹重量", "*包裹单位", "备注",
  "*SKU", "品名(中文)", "*品名(英文)", "*数量", "*申报单价", "*单件重量", "*SKU单位", "SKU长", "SKU宽", "SKU高", "HS CODE", "商品性质",
  "*收件联系人姓", "*收件联系人名", "*收件人联系电话", "*收件国家", "*收件省州", "*收件市府", "收件地区", "*收件邮编", "收件邮箱", "*收件地址1", "收件地址2", "公司名称", "街道", "门牌号", "税号",
  "*寄件联系人姓", "*寄件联系人名", "*寄件人联系电话", "*寄件国家", "*寄件省州", "*寄件市府", "寄件地区", "*寄件邮编", "寄件邮箱", "*寄件地址1", "寄件地址2", "公司名称", "街道", "门牌号", "税号",
  "申报总金额", "申报总数量",
];

/** 模板里的示例行：自定义单号以“示例”开头，导入时跳过（连同它下面的 SKU 续行） */
export const EXAMPLE_REF = "示例-请删除此行";
const isExampleRef = (ref: string) => /^(示例|例[:：]|example)/i.test(ref.trim());

/** 模板各区块的颜色（和 ShipBest 模板一样按区块上色，必填列标题为红色） */
const GROUPS: { from: number; to: number; name: string; fill: string }[] = [
  { from: 1, to: 11, name: "订单与包裹", fill: "FFC6E0B4" },
  { from: 12, to: 23, name: "商品（SKU）", fill: "FFFCE4D6" },
  { from: 24, to: 38, name: "收件人", fill: "FFDDEBF7" },
  { from: 39, to: 53, name: "寄件人（整段留空 = 用账户默认寄件地址）", fill: "FFFFF2CC" },
  { from: 54, to: 55, name: "申报", fill: "FFEDEDED" },
];

const LISTS = {
  insurance: ["不需要", "需要"],
  sign: ["不需要", "直接签名", "间接签名", "成人签名"],
  unit: ["cm/g", "cm/kg", "in/lb", "in/oz"],
  nature: ["普货", "带电", "带磁", "带磁,带电", "液体", "不带磁", "不带电"],
};

const HEADER_NOTES: Record<number, string> = {
  1: "每个订单一个唯一的单号（例如平台订单号）。\n同一订单有多个 SKU 时，第 2 行起这一列留空，只填 SKU 那几列。",
  2: "可以留空：系统会用多个渠道比价，默认选最便宜的。\n也可以从下拉框选指定渠道。",
  10: "包裹尺寸和重量的单位，从下拉框选择。",
  12: "USPS 面单上会加印这里的 SKU。",
  23: "从下拉框选择：一般商品选“普货”；带电池选“带电”。留空默认普货。",
  24: "收件人的姓（Last name）。",
  25: "收件人的名（First name）。",
  39: "寄件人整段都可以留空，留空时使用账户里的默认寄件地址。",
};

export async function buildTemplate(
  sender?: Address | null,
  opts: { examplesInFirstSheet?: boolean; channels?: string[] } = {},
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("导入模板", { views: [{ state: "frozen", ySplit: 1 }] });
  const ex = wb.addWorksheet("填写示例", { views: [{ state: "frozen", ySplit: 1 }] });
  const help = wb.addWorksheet("说明");
  // 下拉框的选项放在隐藏的工作表里（选项多、含逗号也没问题）
  const lists = wb.addWorksheet("_下拉选项", { state: "veryHidden" });
  const channels = opts.channels ?? [];
  const listCols: [keyof typeof LISTS | "channel", string[]][] = [
    ["channel", channels], ["insurance", LISTS.insurance], ["sign", LISTS.sign], ["unit", LISTS.unit], ["nature", LISTS.nature],
  ];
  const ref: Record<string, string> = {};
  listCols.forEach(([k, vals], i) => {
    const col = String.fromCharCode(65 + i);
    vals.forEach((v, j) => (lists.getCell(`${col}${j + 1}`).value = v));
    if (vals.length) ref[k] = `'_下拉选项'!$${col}$1:$${col}$${vals.length}`;
  });

  const styleSheet = (sheet: ExcelJS.Worksheet, withNotes: boolean) => {
    const head = sheet.addRow(SHIPBEST_HEADERS);
    head.height = 30;
    head.eachCell((cell, c) => {
      const g = GROUPS.find((x) => c >= x.from && c <= x.to)!;
      const required = String(cell.value).startsWith("*");
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: g.fill } };
      cell.font = { bold: true, color: { argb: required ? "FFC00000" : "FF404040" } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: "FFBFBFBF" } }, right: { style: "hair", color: { argb: "FFD9D9D9" } } };
      if (withNotes && HEADER_NOTES[c]) cell.note = HEADER_NOTES[c];
    });
    const widths: Record<number, number> = { 1: 22, 2: 20, 12: 20, 13: 12, 14: 14, 23: 16, 26: 16, 33: 26, 34: 16, 48: 26 };
    sheet.columns.forEach((col, i) => (col.width = widths[i + 1] ?? 12));
  };

  const s = sender;
  const senderCols = s
    ? [s.nameLast, s.nameFirst, s.phone ?? "", s.country, s.province ?? "", s.city, s.area ?? "", s.zipCode, s.email ?? "", s.address1, s.address2 ?? "", s.corporateName ?? "", "", "", ""]
    : Array(15).fill("");
  const recip = (last: string, first: string, phone: string, st: string, city: string, zip: string, a1: string, a2 = "") =>
    [last, first, phone, "US", st, city, "", zip, "", a1, a2, "", "", "", ""];
  const ch = channels[0] ?? "";
  const exampleRows = (first: string, second: string) => [
    [first, ch, "不需要", "", "不需要", 25, 20, 10, 900, "cm/g", "", "TS-001", "T恤", "T-shirt", 2, 8, 300, "cm/g", "", "", "", "610910", "普货",
      ...recip("Doe", "John", "512-555-0100", "TX", "Austin", "78701", "500 Congress Ave"), ...senderCols, 21, 3],
    ["", "", "", "", "", "", "", "", "", "", "", "CAP-02", "帽子", "Cap", 1, 5, 150, "cm/g"],
    [second, "", "不需要", "", "不需要", 12, 9, 5, 3.5, "in/lb", "", "BAG-01", "背包", "Backpack", 1, 20, 3.5, "in/lb", "", "", "", "", "",
      ...recip("Smith", "Mary", "213-555-0199", "CA", "Los Angeles", "90001", "123 Main St", "Apt 4"), ...senderCols, 20, 1],
  ];
  const paintExample = (row: ExcelJS.Row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      cell.font = { italic: true, color: { argb: "FF7F7F7F" } };
    });
  };

  // 1) 导入模板：表头 + 一行示例（自定义单号以“示例”开头，导入时自动跳过）
  styleSheet(ws, true);
  if (opts.examplesInFirstSheet) {
    exampleRows("A1001", "A1002").forEach((r) => ws.addRow(r));
  } else {
    paintExample(ws.addRow(exampleRows(EXAMPLE_REF, "")[0]));
  }

  // 2) 填写示例：两个订单，其中第一个有两个 SKU
  styleSheet(ex, false);
  exampleRows("A1001", "A1002").forEach((r) => ex.addRow(r));

  // 下拉框：前 1000 行（要在两个工作表都写完表头和示例之后再加：
  // 给第 2–1001 行设置下拉框会先建出这些空行，之后 addRow 就会从第 1002 行开始）
  const dv = (col: string, key: string, strict: boolean, prompt: string) => {
    if (!ref[key]) return;
    for (const sheet of [ws, ex]) {
      for (let r = 2; r <= 1001; r++) {
        sheet.getCell(`${col}${r}`).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [ref[key]],
          showErrorMessage: strict,
          errorStyle: "stop",
          errorTitle: "请从下拉框选择",
          error: prompt,
        };
      }
    }
  };
  dv("B", "channel", false, "请选择物流产品，或留空由系统比价");
  dv("C", "insurance", true, "请选择：需要 / 不需要");
  dv("E", "sign", true, "请选择签名服务");
  dv("J", "unit", true, "请选择包裹单位");
  dv("R", "unit", true, "请选择 SKU 单位");
  dv("W", "nature", false, "从下拉框选择，或手动输入");

  // 3) 说明
  const notes: [string, string][] = [
    ["格式", "与 ShipBest 后台“导入订单”模板相同，原来的表格可以直接上传。标题为红色（带 *）的列必填。"],
    ["示例行", `“导入模板”第 2 行是填写示例（自定义单号为“${EXAMPLE_REF}”），导入时会自动跳过，可以删掉也可以保留。更完整的示例见“填写示例”工作表。`],
    ["多个 SKU", "同一个订单有多个 SKU 时，第 2 行起“自定义单号”留空，只填 SKU 那几列（见“填写示例”里的 A1001）。"],
    ["物流产品", "可以留空。上传后系统会用多个渠道比价，每单默认选最便宜的；也可以从下拉框指定渠道。"],
    ["单位", "包裹单位和 SKU 单位从下拉框选：cm/g、cm/kg、in/lb、in/oz。"],
    ["保险 / 签名", "从下拉框选择。保险选“需要”时要填保险金额。"],
    ["品名", "品名(英文)必填；品名(中文)可以留空，留空时使用英文品名。"],
    ["商品性质", "从下拉框选择：一般商品选“普货”（不带磁、不带电）；带电池选“带电”，带磁铁选“带磁”。留空默认普货。"],
    ["寄件人", "寄件人整段可以留空，留空时使用账户里的默认寄件地址。"],
    ["颜色", GROUPS.map((g) => g.name).join(" / ") + "：每个区块一种颜色。"],
  ];
  help.addRow(["项目", "说明"]).font = { bold: true };
  notes.forEach((n) => help.addRow(n));
  GROUPS.forEach((g) => {
    const row = help.addRow([g.name, `标题颜色（第 ${g.from}–${g.to} 列）`]);
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: g.fill } };
  });
  help.getColumn(1).width = 30;
  help.getColumn(2).width = 100;
  help.eachRow((r) => (r.alignment = { wrapText: true, vertical: "top" }));
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

/** 单位是 in/oz 时，重量要换算成磅（接口只有 cm/g、cm/kg、in/lb 三种） */
const isOz = (v: string) => /oz|盎司/i.test(v ?? "");

function parseUnit(v: string, def: UnitSystem): UnitSystem {
  const s = (v ?? "").toLowerCase().replace(/\s/g, "");
  if (!s) return def;
  if (/in|lb|oz|英|盎司/.test(s)) return 3;
  if (/kg/.test(s)) return 2;
  if (/g/.test(s)) return 1;
  return def;
}

/** 商品性质：支持代码（2,4）或中文（不带磁,不带电） */
const NATURE_CODE: [RegExp, string][] = [[/不带磁/, "2"], [/带磁/, "1"], [/不带电/, "4"], [/带电/, "3"], [/液体/, "5"]];
const GENERAL = /^(普货|标品|普通|无特殊|general)$/i;
export function parseNature(v: string): string {
  const s = (v ?? "").trim();
  if (!s) return "2,4";
  const codes = new Set<string>();
  if (GENERAL.test(s)) return "2,4";
  for (const part of s.split(/[,，、;；/\s]+/).filter(Boolean)) {
    if (/^[1-5]$/.test(part)) codes.add(part);
    else {
      const hit = NATURE_CODE.find(([re]) => re.test(part));
      if (hit) codes.add(hit[1]);
    }
  }
  if (!codes.size) return "2,4";
  // 只写了“带电”时补上“不带磁”，只写了“带磁”时补上“不带电”
  if (!codes.has("1") && !codes.has("2")) codes.add("2");
  if (!codes.has("3") && !codes.has("4")) codes.add("4");
  return [...codes].sort().join(",");
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
    const skuUnitText = get(r, col.skuUnit) || get(r, col.unit);
    const skuUnit = parseUnit(skuUnitText, st.defaultUnit);
    const sku: SkuItem = {
      sku: skuCode,
      // 中文品名可以留空：用英文品名补上
      productNameCn: get(r, col.cn) || get(r, col.en),
      productNameEn: get(r, col.en),
      quantity: Math.round(num(get(r, col.qty))),
      declaredUnitPrice: num(get(r, col.price)),
      declaredCurrency: st.defaultCurrency,
      hsCode: get(r, col.hs),
      productNature: parseNature(get(r, col.nature)),
      length: num(get(r, col.skuLen)),
      width: num(get(r, col.skuWid)),
      height: num(get(r, col.skuHei)),
      weight: isOz(skuUnitText) ? Math.round((num(get(r, col.skuWt)) / 16) * 1000) / 1000 : num(get(r, col.skuWt)),
      unit: skuUnit,
    };
    // 模板里的示例行（以及它下面的 SKU 续行）跳过
    if (ref && isExampleRef(ref)) {
      current = null;
      continue;
    }
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
          weight: isOz(get(r, col.unit)) ? Math.round((num(get(r, col.wt)) / 16) * 1000) / 1000 : num(get(r, col.wt)),
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
  const list = listChannels(true);
  // 渠道原名、代码，或客户看到的名称（客户下载的模板里是这个）
  const c = list.find((ch) => norm(ch.name) === n || norm(ch.code) === n) ?? list.find((ch) => norm(publicChannel(ch).name) === n);
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
  /** 我们的成本（只给后台看，客户端会去掉） */
  cost?: number;
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
  /** 可能重复导入等提醒 */
  warning: string | null;
  /** 收件地址核对（USPS） */
  address: AddressCheck | null;
  shipmentId: number | null;
  trackingNo: string | null;
  hasLabel: boolean;
  /** 已扣款、面单还在生成中 */
  labelPending: boolean;
}

export function createJob(input: {
  customerId: number;
  createdBy: "admin" | "customer";
  filename: string;
  channels: string[];
  pickMode: PickMode;
  orders: ParsedOrder[];
}): number {
  const enabled = customerChannels(input.customerId).map((c) => c.code);
  if (!enabled.length) throw new Error("该客户还没有开通任何物流渠道，请到客户详情里开通");
  const channels = input.channels.filter((c) => enabled.includes(c));
  return db().transaction(() => {
    const r = db()
      .prepare("INSERT INTO batch_jobs (customer_id, created_by, filename, channel_mode, channels_json, pick_mode, status) VALUES (?,?,?,?,?,?, 'quoting')")
      .run(input.customerId, input.createdBy, input.filename, input.pickMode, JSON.stringify(channels.length ? channels : enabled), input.pickMode);
    const jobId = Number(r.lastInsertRowid);
    const stmt = db().prepare(
      "INSERT INTO batch_job_rows (job_id, row_no, customer_ref, req_json, file_channel, status, error, warning, selected) VALUES (?,?,?,?,?,?,?,?,?)",
    );
    for (const o of input.orders) {
      // 订单号已经下过单（没取消）：直接标错误，不能提交
      const shipped = o.customerRef ? activeShipmentByRef(input.customerId, o.customerRef) : undefined;
      if (shipped) o.errors.push(duplicateRefMessage(o.customerRef, shipped));
      const warning = o.customerRef && !shipped ? duplicateWarning(input.customerId, o.customerRef, jobId) : null;
      stmt.run(jobId, o.rowNo, o.customerRef || null, JSON.stringify(o.req), o.fileChannel || null, o.errors.length ? "error" : "pending", o.errors.join("；") || null, warning, warning || o.errors.length ? 0 : 1);
    }
    return jobId;
  })();
}

/**
 * 同一客户的订单号在另一个还没提交的批次里 → 提醒可能重复导入，默认不勾选。
 * （已经下过单的在上面直接标错误；两个批次都勾选提交时，后提交的那单会被拦下）
 */
function duplicateWarning(customerId: number, ref: string, jobId: number): string | null {
  const r = db()
    .prepare(
      `SELECT j.id, j.filename, j.created_at FROM batch_job_rows r JOIN batch_jobs j ON j.id = r.job_id
       WHERE j.customer_id = ? AND r.customer_ref = ? AND r.job_id <> ? AND r.status IN ('pending', 'quoted') LIMIT 1`,
    )
    .get(customerId, ref, jobId) as { id: number; filename: string | null; created_at: string } | undefined;
  if (r) return `订单号 ${ref} 在另一个未提交的批次里（${r.filename ?? "批量导入"}，${r.created_at.slice(0, 10)}），可能是重复导入，默认不提交`;
  return null;
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
  warning: string | null;
  shipment_id: number | null;
  addr_json?: string | null;
}

type RowPatch = Partial<Pick<JobRowDb, "channel_code" | "channel_name" | "price" | "currency" | "status" | "error" | "shipment_id" | "quotes_json" | "selected" | "addr_json">>;

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
        warning: r.warning,
        address: r.addr_json ? (JSON.parse(r.addr_json) as AddressCheck) : null,
        shipmentId: r.shipment_id,
        trackingNo: s?.trackingNo ?? null,
        hasLabel: !!s?.labelPath,
        labelPending: s?.status === "pending",
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

/** 删除还没提交的订单（待出单的订单还没扣款，可以直接删除） */
export function deleteRows(jobId: number, rowIds: number[]) {
  assertEditable(jobId);
  const ids = jobRows(jobId).filter((r) => rowIds.includes(r.id) && r.status !== "created").map((r) => r.id);
  const stmt = db().prepare("DELETE FROM batch_job_rows WHERE id = ? AND job_id = ? AND status != 'created'");
  db().transaction(() => ids.forEach((id) => stmt.run(id, jobId)))();
  // 批次里没有订单了就删掉批次
  if (!jobRows(jobId).length) db().prepare("DELETE FROM batch_jobs WHERE id = ?").run(jobId);
  return ids.length;
}

/** 所有批次里还没提交的订单（待出单） */
export function listDraftRows(customerId?: number) {
  return (
    db()
      .prepare(
        `SELECT r.id, r.job_id, r.row_no, r.customer_ref, r.req_json, r.channel_name, r.price, r.status, r.error, j.filename, j.created_at, c.name AS customer_name
         FROM batch_job_rows r JOIN batch_jobs j ON j.id = r.job_id JOIN customers c ON c.id = j.customer_id
         WHERE r.status IN ('quoted', 'error', 'failed', 'pending') ${customerId ? "AND j.customer_id = ?" : ""}
         ORDER BY j.id DESC, r.row_no`,
      )
      .all(...(customerId ? [customerId] : [])) as {
      id: number; job_id: number; row_no: number; customer_ref: string | null; req_json: string; channel_name: string | null; price: number | null;
      status: RowStatus; error: string | null; filename: string | null; created_at: string; customer_name: string;
    }[]
  ).map((r) => {
    const req = JSON.parse(r.req_json) as ShipmentRequest;
    return { ...r, recipient: `${req.recipient.nameFirst} ${req.recipient.nameLast}, ${req.recipient.city} ${req.recipient.province ?? ""} ${req.recipient.zipCode}` };
  });
}

/** 换一组渠道重新试算（未下单的订单） */
export function requote(jobId: number, channels: string[]) {
  assertEditable(jobId);
  const enabled = customerChannels(getJob(jobId)!.customerId).map((c) => c.code);
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
          ? { code, name: q.channelName, ok: true, price: q.price!, currency: q.currency, zone: q.zone ?? null, cost: q.cost }
          : { code, name: q.channelName, ok: false, error: q.error });
      } catch (e) {
        quotes.push({ code, name: getChannel(code)?.name ?? code, ok: false, error: (e as Error).message });
      }
    }
    quotes.sort((a, b) => Number(b.ok) - Number(a.ok) || (a.price ?? 0) - (b.price ?? 0));
    // 收件地址核对：有问题的单默认不勾选，客户确认（重新勾选）后才提交
    const firstCheck = !r.addr_json;
    const addr = await checkAddress(req.recipient);
    const addrPatch: RowPatch = { addr_json: addr.status === "unavailable" || addr.status === "skipped" ? null : JSON.stringify(addr) };
    if (firstCheck && needsAck(addr)) addrPatch.selected = 0;
    setRow(r.id, addrPatch);
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
        // 勾选了有问题地址的单 = 客户确认过
        addressCheck: r.addr_json ? { ...(JSON.parse(r.addr_json) as AddressCheck), ...(needsAck(JSON.parse(r.addr_json)) ? { acknowledged: true } : {}) } : null,
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
    // 已经提交、扣过款的订单照样在后台取回面单（不占用任务，充值后可以马上继续提交）
    void refreshCreatedLabels(jobId).catch(() => null);
    return;
  }
  setJob(jobId, "labeling");
  await waitLabels(jobId);
}

/** 轮询本批次里已提交、面单还没生成的订单，直到都出面单或超时 */
async function refreshCreatedLabels(jobId: number, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pending = jobRows(jobId)
      .filter((r) => r.status === "created" && r.shipment_id)
      .map((r) => getShipment(r.shipment_id!)!)
      .filter((s) => s && s.status === "pending");
    if (!pending.length) return;
    await pool(pending, 3, async (s) => {
      await refreshShipment(s.id).catch(() => null);
    });
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function waitLabels(jobId: number) {
  await refreshCreatedLabels(jobId, 120_000);
  // 还有没提交的订单时回到“待确认”，可以继续提交；剩下的订单重新默认勾选（有重复提醒的除外）
  const left = jobRows(jobId).filter((r) => r.status === "quoted");
  for (const r of left) if (!r.selected && !r.warning && !needsAck(r.addr_json ? JSON.parse(r.addr_json) : null)) setRow(r.id, { selected: 1 });
  setJob(jobId, left.length ? "ready" : "done");
}

/** 任务所属客户的默认寄件地址 */
export function senderFor(customerId: number): Address | null {
  return getCustomer(customerId)?.sender ?? getSettings().sender;
}
