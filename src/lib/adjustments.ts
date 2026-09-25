import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import {
  batchExists,
  findShipmentByKey,
  getSettings,
  insertAdjustmentBatch,
  listAdjustments,
  type AdjustmentPolicy,
  type NewAdjustment,
} from "./db";
import type { MarkupRule } from "./pricing";
import { describeRow, guessHeaderRow } from "./sheetGuess";

/* ---------------- 读取表格 ---------------- */

export interface ParsedSheet {
  filename: string;
  fileHash: string;
  rows: string[][];
  /** 猜测的表头行（0 开始） */
  headerRow: number;
  alreadyImported: boolean;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue); // 公式
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text); // 超链接
    if ("error" in v) return "";
    return "";
  }
  // Excel 里的小数常带浮点误差，例如 0.06000000000000005
  if (typeof v === "number") return String(Math.round(v * 1e6) / 1e6);
  return String(v).trim();
}

async function parseXlsx(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  // 取数据最多的工作表
  const ws = [...wb.worksheets].sort((a, b) => b.actualRowCount - a.actualRowCount)[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = row.values as ExcelJS.CellValue[];
    rows.push(vals.slice(1).map(cellText));
  });
  return rows;
}

/** 简单的 CSV 解析（支持引号、逗号/分号/Tab 分隔、UTF-8 或 GBK 编码） */
export function parseCsv(buf: Buffer): string[][] {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    // 中文 Excel 另存的 CSV 常是 GBK
    text = new TextDecoder("gbk").decode(buf);
  }
  text = text.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) {
      row.push(cell.trim());
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((x) => x)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x)) rows.push(row);
  return rows;
}

export async function parseSheet(filename: string, buf: Buffer): Promise<ParsedSheet> {
  const lower = filename.toLowerCase();
  let rows: string[][];
  if (lower.endsWith(".xlsx")) rows = await parseXlsx(buf);
  else if (lower.endsWith(".csv") || lower.endsWith(".txt")) rows = parseCsv(buf);
  else if (lower.endsWith(".xls")) throw new Error("暂不支持旧版 .xls，请在 Excel 里“另存为” .xlsx 或 .csv 后再上传");
  else throw new Error("请上传 .xlsx 或 .csv 文件");
  if (!rows.length) throw new Error("表格是空的");
  // 按表格内容（而不是文件字节）判重：同一张表重新另存后字节会变，但内容不变
  const fileHash = contentHash(rows);
  return { filename, fileHash, rows: rows.slice(0, 20000), headerRow: guessHeaderRow(rows), alreadyImported: batchExists(fileHash) };
}

export function contentHash(rows: string[][]): string {
  // 去掉行尾空单元格：xlsx 和另存的 csv 在这点上常不一致
  const norm = rows
    .map((r) => {
      const cells = r.map((c) => c.trim());
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      return cells.join("\u0001");
    })
    .join("\u0002");
  return createHash("sha256").update(norm).digest("hex");
}

export { guessColumns } from "./sheetGuess";

/* ---------------- 金额 ---------------- */

/** "¥1,234.50" / "(3.20)" / "-3.2" / "USD 5" → 数字；无法识别返回 null */
export function parseAmount(raw: string): number | null {
  let s = (raw ?? "").trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[,，\s]/g, "").replace(/^[A-Za-z$¥￥€£]+|[A-Za-z$¥￥€£元]+$/g, "");
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  return Math.round((neg ? -n : n) * 100) / 100;
}

export function customerAmountFor(costAmount: number, policy: AdjustmentPolicy, rule: MarkupRule): number {
  if (policy === "none") return 0;
  if (policy === "with_markup") return Math.round(costAmount * (1 + rule.percent / 100) * 100) / 100;
  return costAmount;
}

/* ---------------- 预览 / 导入 ---------------- */

export interface Mapping {
  headerRow: number;
  keyCol: number;
  /** 备用单号列（-1 表示没有）：主单号匹配不到时再用 */
  altKeyCol: number;
  amountCol: number;
  reasonCol: number; // -1 表示没有
  /** charge：正数 = ShipBest 向我们补扣；refund：正数 = 退给我们 */
  positiveMeans: "charge" | "refund";
}

export interface PreviewRow {
  rowNo: number;
  matchKey: string;
  rawAmount: string;
  costAmount: number | null;
  customerAmount: number | null;
  reason: string;
  shipmentId: number | null;
  customNo: string | null;
  customerId: number | null;
  customerName: string | null;
  /** 该面单已有相同金额的补差记录，可能重复 */
  possibleDuplicate: boolean;
  error?: string;
}

export interface Preview {
  rows: PreviewRow[];
  policy: AdjustmentPolicy;
  byCustomer: { customerId: number; customerName: string; count: number; costTotal: number; customerTotal: number }[];
  unmatched: number;
  invalid: number;
  duplicates: number;
  costTotal: number;
}

export function buildPreview(rows: string[][], m: Mapping): Preview {
  const { adjustmentPolicy: policy } = getSettings();
  const out: PreviewRow[] = [];
  const cache = new Map<string, ReturnType<typeof findShipmentByKey>>();
  for (let i = m.headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const matchKey = (r[m.keyCol] ?? "").trim();
    const rawAmount = r[m.amountCol] ?? "";
    if (!matchKey && !rawAmount.trim()) continue;
    // 合计 / 小计行
    if (/^(合计|总计|小计|total|sum)/i.test(matchKey) || (!matchKey && /合计|总计|total/i.test(r.join(" ")))) continue;
    const reason = describeRow(rows[m.headerRow] ?? [], r, m.reasonCol);
    const amt = parseAmount(rawAmount);
    // 金额为 0 的行没有影响，跳过
    if (amt === 0) continue;
    const row: PreviewRow = {
      rowNo: i + 1,
      matchKey,
      rawAmount,
      costAmount: null,
      customerAmount: null,
      reason,
      shipmentId: null,
      customNo: null,
      customerId: null,
      customerName: null,
      possibleDuplicate: false,
    };
    if (!matchKey) row.error = "单号为空";
    else if (amt === null) row.error = "金额无法识别";
    if (!row.error && amt !== null) {
      row.costAmount = m.positiveMeans === "charge" ? amt : -amt;
      const altKey = m.altKeyCol >= 0 ? (r[m.altKeyCol] ?? "").trim() : "";
      const lookup = (k: string) => {
        if (!cache.has(k)) cache.set(k, findShipmentByKey(k));
        return cache.get(k);
      };
      const s = lookup(matchKey) ?? (altKey ? lookup(altKey) : null);
      if (s) {
        row.shipmentId = s.id;
        row.customNo = s.customNo;
        row.customerId = s.customerId;
        row.customerName = s.customerName;
        row.customerAmount = customerAmountFor(row.costAmount, policy, s.rule);
        row.possibleDuplicate = listAdjustments({ shipmentId: s.id }).some((a) => Math.abs(a.costAmount - row.costAmount!) < 0.005);
      }
    }
    out.push(row);
  }

  const groups = new Map<number, Preview["byCustomer"][number]>();
  for (const r of out) {
    if (!r.customerId) continue;
    const g = groups.get(r.customerId) ?? { customerId: r.customerId, customerName: r.customerName!, count: 0, costTotal: 0, customerTotal: 0 };
    g.count++;
    g.costTotal += r.costAmount!;
    g.customerTotal += r.customerAmount!;
    groups.set(r.customerId, g);
  }
  return {
    rows: out,
    policy,
    byCustomer: [...groups.values()].sort((a, b) => b.customerTotal - a.customerTotal),
    unmatched: out.filter((r) => !r.error && !r.shipmentId).length,
    invalid: out.filter((r) => r.error).length,
    duplicates: out.filter((r) => r.possibleDuplicate).length,
    costTotal: out.reduce((a, r) => a + (r.costAmount ?? 0), 0),
  };
}

/**
 * 导入：有效行全部保存（包括没匹配上的，方便之后手动关联和对账），
 * 金额无法识别的行跳过。同一个文件不能重复导入。
 */
export function importAdjustments(filename: string, rows: string[][], m: Mapping, note: string | null) {
  const fileHash = contentHash(rows);
  if (batchExists(fileHash)) throw new Error("这个文件已经导入过了（内容完全相同）");
  const preview = buildPreview(rows, m);
  const valid: NewAdjustment[] = preview.rows
    .filter((r) => !r.error && r.costAmount !== null)
    .map((r) => ({
      rowNo: r.rowNo,
      matchKey: r.matchKey,
      shipmentId: r.shipmentId,
      customerId: r.customerId,
      costAmount: r.costAmount!,
      customerAmount: r.shipmentId ? r.customerAmount! : 0,
      reason: r.reason || null,
      raw: rows[r.rowNo - 1] ?? [],
    }));
  if (!valid.length) throw new Error("没有可导入的有效行");
  return insertAdjustmentBatch({ filename, fileHash, policy: preview.policy, note, header: rows[m.headerRow] ?? [] }, valid);
}
