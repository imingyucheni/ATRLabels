/**
 * 嘉谷（GDE）对账单导入：嘉谷每周发一个 Excel，里面一周一个工作表，而且是累计的（新的文件里还有以前几周的表）。
 * - “XX账单”：这一周出单的运费（按承运商分表：GOFO、Swiftx、uniuni、USPS-D、联邦、Ontrac…）
 * - “XX补收账单”：承运商复核重量 / 尺寸 / 地址后补收的费用
 * - “XX取消手续费”：取消的面单退回的钱（负数）
 * - “汇总表”：每期账单金额、我们的付款和账户结余
 *
 * 导入时：
 * - 每一行按运单号（或客户单号 = 我们的单号）对应到面单；以前导入过的行（同一张表、同一单、同样金额）自动跳过；
 * - 补收：按“补差转嫁规则”记成补差，向客户补收（和 ShipBest 补差表一样）；
 * - 运费账单：和下单时记的成本比，差额也记成补差（多退少补，可以不勾选）；
 * - 已取消的单被扣了费、状态对不上的、系统里找不到的：列出来人工核对，不动客户余额。
 */
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import {
  db,
  findShipmentByKey,
  getSettings,
  getShipment,
  insertAdjustmentBatch,
  isInternalCustomer,
  listAdjustments,
  normalizeTrackingKey,
  updateShipment,
  STATUS_LABEL,
  ADJUSTMENT_POLICY_LABEL,
  type AdjustmentPolicy,
  type NewAdjustment,
} from "./db";
import { cellText, customerAmountFor } from "./adjustments";
import { postAdjustment } from "./ledger";
import { isJiaguCode } from "./shipbest/jiagu";
import { assertZipSize } from "./zip";
import { GDE_FEES, type GdeIssueType, type GdeKind } from "./gdeBillShared";

export { GDE_FEES, GDE_ISSUE_LABEL, GDE_KIND_LABEL, type GdeIssueType, type GdeKind } from "./gdeBillShared";

export interface GdeLine {
  sheet: string;
  kind: GdeKind;
  rowNo: number;
  orderNo: string;
  tracking: string;
  /** 客户单号：我们下单时传的单号（ATR…）；直接在嘉谷下的单是客户自己的订单号 */
  refNo: string;
  box: string;
  product: string;
  shipDate: string;
  zone: string;
  weight: string;
  dims: string;
  amount: number;
  fees: { name: string; amount: number }[];
  /** 判重用：同一张表、同一单、同一箱、同样金额（同一张表里完全一样的行按出现次数区分） */
  sig: string;
}

export interface GdeSheet {
  name: string;
  kind: GdeKind;
  lines: GdeLine[];
  total: number;
  /** 表格最后一行写的合计（核对用） */
  stated: number | null;
}

export interface GdeSummary {
  payments: { amount: number; note: string }[];
  paymentTotal: number;
  /** 最后一期之后的结余 */
  balance: number | null;
  /** 待核销金额、冻结金额、可用余额等 */
  extras: { label: string; value: number }[];
}

export interface GdeWorkbook {
  sheets: GdeSheet[];
  summary: GdeSummary | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => {
  const n = parseFloat((s ?? "").replace(/[,\s$]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** 按工作表名称判断是哪种账单 */
export function sheetKind(name: string): GdeKind {
  if (/取消/.test(name)) return "cancel";
  if (/补收|补扣|补差|调整/.test(name)) return "extra";
  return "base";
}

const isBillHeader = (h: string[]) => h.includes("运单号") && h.includes("总金额") && (h.includes("客户单号") || h.includes("订单号"));

/** 读嘉谷对账单；不是这个格式的返回 null */
export async function parseGdeWorkbook(buf: Buffer): Promise<GdeWorkbook | null> {
  assertZipSize(buf);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheets: GdeSheet[] = [];
  let summary: GdeSummary | null = null;
  for (const ws of wb.worksheets) {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      rows[n - 1] = (row.values as ExcelJS.CellValue[]).slice(1).map(cellText);
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    if (/汇总/.test(ws.name)) {
      summary = parseSummary(rows);
      continue;
    }
    const hi = rows.slice(0, 5).findIndex((r) => isBillHeader(r.map((c) => c.trim())));
    if (hi < 0) continue;
    sheets.push(parseSheet(ws.name.trim(), rows, hi));
  }
  if (!sheets.length) return null;
  return { sheets, summary };
}

function parseSheet(name: string, rows: string[][], hi: number): GdeSheet {
  const h = rows[hi].map((c) => c.trim());
  const col = (...names: (string | RegExp)[]) => {
    for (const n of names) {
      const i = h.findIndex((x) => (typeof n === "string" ? x === n : n.test(x)));
      if (i >= 0) return i;
    }
    return -1;
  };
  const c = {
    orderNo: col("订单号"),
    tracking: col("运单号"),
    refNo: col("客户单号"),
    box: col("箱号"),
    product: col("产品名称"),
    shipDate: col("发货时间", "Shipment Date"),
    zone: col("分区代码", "分区"),
    amount: col("总金额"),
    unit: col("类型"),
    weight: col("计费重(KG)", /^账单重量/, "重量", "重量(KG)"),
    len: col(/^长/),
    wid: col(/^宽/),
    hei: col(/^高/),
  };
  const amountAt = c.amount;
  // 总金额后面的列都是费用明细（列名不认识的也算，例如以后新加的费用）
  const feeCols = h.map((x, i) => ({ name: x, i })).filter((f) => f.i > amountAt && f.name && (GDE_FEES.includes(f.name) || /费/.test(f.name)));
  const weightHeader = c.weight >= 0 ? h[c.weight] : "";
  const unitOf = (r: string[]) => (c.unit >= 0 ? (r[c.unit] ?? "").trim().toUpperCase() : /KG/i.test(weightHeader) ? "KG" : /LB/i.test(weightHeader) ? "LB" : "");
  const kind = sheetKind(name);
  const lines: GdeLine[] = [];
  const seen = new Map<string, number>();
  let stated: number | null = null;
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (k: number) => (k >= 0 ? (r[k] ?? "").trim() : "");
    const tracking = get(c.tracking);
    const orderNo = get(c.orderNo);
    const refNo = get(c.refNo);
    if (!tracking && !orderNo && !refNo) {
      // 合计行：只有总金额那一格有数
      const t = num(get(amountAt));
      if (t !== null) stated = r2(t);
      continue;
    }
    const fees = feeCols.map((f) => ({ name: f.name, amount: r2(num(r[f.i] ?? "") ?? 0) })).filter((f) => Math.abs(f.amount) >= 0.005);
    const total = num(get(amountAt));
    const amount = r2(total ?? fees.reduce((a, f) => a + f.amount, 0));
    if (Math.abs(amount) < 0.005) continue;
    const w = get(c.weight);
    const dims = [get(c.len), get(c.wid), get(c.hei)];
    const box = get(c.box);
    const key = `${name}|${normalizeTrackingKey(tracking || refNo || orderNo)}|${box}|${amount.toFixed(2)}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    lines.push({
      sheet: name, kind, rowNo: i + 1, orderNo, tracking, refNo, box,
      product: get(c.product), shipDate: get(c.shipDate), zone: get(c.zone),
      weight: w ? `${w} ${unitOf(r)}`.trim() : "",
      dims: dims.every((d) => num(d)) ? `${dims.join("×")} in` : "",
      amount, fees, sig: `${key}#${n}`,
    });
  }
  return { name, kind, lines, total: r2(lines.reduce((a, l) => a + l.amount, 0)), stated };
}

function parseSummary(rows: string[][]): GdeSummary {
  const payments: GdeSummary["payments"] = [];
  const extras: GdeSummary["extras"] = [];
  let balance: number | null = null;
  for (const r of rows) {
    const label = (r[0] ?? "").trim();
    if (!label || /^(汇总表|日期)$/.test(label)) continue;
    const amount = num(r[1] ?? ""), pay = num(r[2] ?? ""), bal = num(r[4] ?? "");
    if (/待核销|冻结|可用|期初/.test(label)) {
      const v = amount ?? bal;
      if (v !== null) extras.push({ label, value: r2(v) });
      continue;
    }
    if (pay !== null && pay !== 0) payments.push({ amount: r2(pay), note: (r[3] ?? "").trim() });
    if (bal !== null) balance = r2(bal);
  }
  return { payments, paymentTotal: r2(payments.reduce((a, p) => a + p.amount, 0)), balance, extras };
}

/** 判重的“行”：签名去掉金额和序号（同一张表、同一单、同一箱） */
const lineKey = (sig: string) => sig.replace(/\|[-\d.]+#\d+$/, "");

/* ---------------- 已导入的行 ---------------- */

function ensureTables() {
  const conn = db();
  conn.exec(`CREATE TABLE IF NOT EXISTS provider_bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    filename TEXT NOT NULL,
    adjustment_batch_id INTEGER REFERENCES adjustment_batches(id) ON DELETE CASCADE,
    stats_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS provider_bill_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL REFERENCES provider_bills(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    sig TEXT NOT NULL,
    sheet TEXT NOT NULL,
    kind TEXT NOT NULL,
    row_no INTEGER NOT NULL,
    tracking TEXT,
    ref_no TEXT,
    order_no TEXT,
    amount REAL NOT NULL,
    data_json TEXT NOT NULL,
    shipment_id INTEGER,
    adjustment_id INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bill_line_sig ON provider_bill_lines(provider, sig);
  CREATE INDEX IF NOT EXISTS idx_bill_line_ship ON provider_bill_lines(shipment_id);
  CREATE TABLE IF NOT EXISTS provider_bill_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL REFERENCES provider_bills(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    type TEXT NOT NULL,
    shipment_id INTEGER,
    tracking TEXT,
    order_no TEXT,
    ref_no TEXT,
    custom_no TEXT,
    sheet TEXT,
    amount REAL NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    resolved_by TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_bill_issue_open ON provider_bill_issues(provider, status)`);
  return conn;
}

/* ---------------- 预览 ---------------- */

export interface GdeCharge {
  sheet: string;
  kind: "extra" | "base";
  tracking: string;
  refNo: string;
  shipmentId: number | null;
  customNo: string | null;
  customerId: number | null;
  customerName: string | null;
  /** 服务商向我们多收（正）/ 退（负） */
  costAmount: number;
  /** 向客户补收（正）/ 退（负）；没关联到面单的是 0 */
  customerAmount: number;
  /** 客户看得到的说明（不写服务商名称和成本金额） */
  reason: string;
  /** 只给后台看的核对说明 */
  detail: string;
  weight: string;
  dims: string;
  product: string;
  shipDate: string;
  zone: string;
  sigs: string[];
}

export interface GdeIssue {
  level: "warn" | "info";
  type: GdeIssueType;
  sheet: string;
  tracking: string;
  /** 嘉谷的订单号（SMM…），和嘉谷沟通时用 */
  orderNo: string;
  refNo: string;
  customNo: string | null;
  shipmentId: number | null;
  amount: number;
  message: string;
}

export interface GdePreview {
  sheets: { name: string; kind: GdeKind; lines: number; newLines: number; total: number; newTotal: number; stated: number | null }[];
  summary: GdeSummary | null;
  charges: GdeCharge[];
  issues: GdeIssue[];
  notInSystem: { count: number; total: number; lines: { sheet: string; tracking: string; refNo: string; amount: number }[] };
  totals: { lines: number; newLines: number; alreadyImported: number; revised: number; newBilled: number; matched: number; costToBook: number; customerTotal: number };
  /** 金额改过的行（导入时记成 revised，不算进运费 / 补收合计） */
  revisedSigs: string[];
  policy: AdjustmentPolicy;
  policyLabel: string;
  /** 已取消的单：按账单算出服务商实收的取消费（导入时写回面单，对账用） */
  cancelFees: { shipmentId: number; amount: number }[];
  /** 之前标记“已取消仍被收费”、这次账单已经全部退回的单：导入时自动标记已解决 */
  resolved: { shipmentId: number; note: string }[];
}

export interface GdeOptions {
  /** 运费账单和下单成本的差额也记补差（向客户多退少补） */
  baseDiff: boolean;
}

/** 补收 / 运费差额的说明：费用名称、账单重量和尺寸（不带金额，客户看到的是补收给他的金额） */
function reasonText(kind: "extra" | "base", fees: string[], weight: string, dims: string, refund = false) {
  const head = kind === "extra" ? "承运商账单补收" : refund ? "承运商账单运费差额（退）" : "承运商账单运费差额";
  const what = fees.length ? `：${fees.join(" + ")}` : "";
  // 不用“ · ”分隔：补差说明在页面上按“ · ”拆开逐段翻译
  const tail = weight ? `（账单重量 ${weight}${dims ? `，尺寸 ${dims}` : ""}）` : dims ? `（尺寸 ${dims}）` : "";
  return `${head}${what}${tail}`;
}

const feeNames = (lines: GdeLine[]) => [...new Set(lines.flatMap((l) => l.fees.filter((f) => f.amount > 0).map((f) => f.name)))];

export function buildGdePreview(wb: GdeWorkbook, opts: GdeOptions): GdePreview {
  const conn = ensureTables();
  // 嘉谷账单的补差（补收、运费差额）一律按这一单下单时的加价比例向客户多退少补（不看通用的补差转嫁设置）
  const policy: AdjustmentPolicy = "with_markup";
  const importedRows = conn.prepare("SELECT sig, amount FROM provider_bill_lines WHERE provider = 'jiagu'").all() as { sig: string; amount: number }[];
  const imported = new Set(importedRows.map((r) => r.sig));
  // 同一张表、同一单、同一箱以前导入过（不管金额）：这次金额不一样就是账单改过，要核对，不能当成新的一笔再算一次
  const importedAt = new Map<string, number[]>();
  for (const r of importedRows) importedAt.set(lineKey(r.sig), [...(importedAt.get(lineKey(r.sig)) ?? []), r.amount]);
  // 用通用补差导入导过的（不是这里导的）：同一单同样金额的补收不再记
  const legacy = new Set<string>();
  for (const a of conn
    .prepare("SELECT match_key, shipment_id, cost_amount FROM adjustments WHERE id NOT IN (SELECT adjustment_id FROM provider_bill_lines WHERE adjustment_id IS NOT NULL)")
    .all() as { match_key: string; shipment_id: number | null; cost_amount: number }[]) {
    legacy.add(`${normalizeTrackingKey(a.match_key)}|${a.cost_amount.toFixed(2)}`);
    if (a.shipment_id) legacy.add(`#${a.shipment_id}|${a.cost_amount.toFixed(2)}`);
  }
  const prior = (sid: number) => {
    const rows = conn.prepare("SELECT kind, SUM(amount) AS s FROM provider_bill_lines WHERE provider = 'jiagu' AND shipment_id = ? GROUP BY kind").all(sid) as { kind: GdeKind; s: number }[];
    const diff = conn
      .prepare("SELECT COALESCE(SUM(a.cost_amount), 0) AS s FROM provider_bill_lines l JOIN adjustments a ON a.id = l.adjustment_id WHERE l.kind = 'base' AND l.shipment_id = ?")
      .get(sid) as { s: number };
    const by = (k: GdeKind) => rows.find((r) => r.kind === k)?.s ?? 0;
    return { base: by("base"), cancel: by("cancel"), extra: by("extra"), diff: diff.s };
  };

  const cache = new Map<string, ReturnType<typeof findShipmentByKey>>();
  const find = (k: string) => {
    if (!k) return null;
    if (!cache.has(k)) cache.set(k, findShipmentByKey(k));
    return cache.get(k) ?? null;
  };
  const match = (l: GdeLine) => find(l.tracking) ?? find(l.refNo) ?? find(l.orderNo);

  const sheets: GdePreview["sheets"] = [];
  const fresh: { line: GdeLine; sid: number | null }[] = [];
  const revised: { line: GdeLine; sid: number | null; before: number[] }[] = [];
  let lineCount = 0;
  for (const s of wb.sheets) {
    const news = s.lines.filter((l) => !imported.has(l.sig));
    lineCount += s.lines.length;
    sheets.push({ name: s.name, kind: s.kind, lines: s.lines.length, newLines: news.length, total: s.total, newTotal: r2(news.reduce((a, l) => a + l.amount, 0)), stated: s.stated });
    for (const l of news) {
      const before = importedAt.get(lineKey(l.sig));
      if (before) revised.push({ line: l, sid: match(l)?.id ?? null, before });
      else fresh.push({ line: l, sid: match(l)?.id ?? null });
    }
  }

  const charges: GdeCharge[] = [];
  const issues: GdeIssue[] = [];
  const cancelFees: GdePreview["cancelFees"] = [];
  const resolved: GdePreview["resolved"] = [];
  const outside: GdePreview["notInSystem"]["lines"] = [];
  const issue = (level: GdeIssue["level"], type: GdeIssueType, l: GdeLine, sid: number | null, customNo: string | null, amount: number, message: string, sheet = l.sheet) =>
    issues.push({ level, type, sheet, tracking: l.tracking || l.refNo, orderNo: l.orderNo, refNo: l.refNo, customNo, shipmentId: sid, amount: r2(amount), message });

  // 以前导入过的表里，这一单的金额变了（嘉谷改过账单，或者上传了旧版本的文件）：不自动处理，列出来核对
  for (const { line: l, sid, before } of revised) {
    const s = sid ? getShipment(sid) : null;
    issue("warn", "bill_changed", l, sid, s?.customNo ?? null, l.amount,
      `账单「${l.sheet}」里这一单的金额和以前导入的不一样：以前 ${before.map((b) => b.toFixed(2)).join(" / ")}，这次 ${l.amount.toFixed(2)}。没有自动处理（不会重复收），请和嘉谷核对哪个对`);
  }

  // 系统里找不到的单（直接在嘉谷下的单等）：只列出来
  for (const { line: l, sid } of fresh) {
    if (sid) continue;
    outside.push({ sheet: l.sheet, tracking: l.tracking, refNo: l.refNo, amount: l.amount });
    if (/^ATR/i.test(l.refNo)) issue("warn", "not_found", l, null, null, l.amount, "单号是本系统的格式，但系统里找不到这一单（可能是测试 / 沙盒环境下的单）");
  }

  // 按面单汇总运费账单和取消退款
  const touched = new Map<number, { base: GdeLine[]; cancel: GdeLine[]; extra: GdeLine[] }>();
  for (const { line: l, sid } of fresh) {
    if (!sid) continue;
    const g = touched.get(sid) ?? { base: [], cancel: [], extra: [] };
    g[l.kind].push(l);
    touched.set(sid, g);
  }

  for (const [sid, g] of touched) {
    const s = getShipment(sid)!;
    const internal = isInternalCustomer(s.customerId);
    const first = g.base[0] ?? g.cancel[0] ?? g.extra[0];
    if (!isJiaguCode(s.channelCode)) issue("warn", "channel", first, sid, s.customNo, first.amount, `系统里这单不是 GDE 渠道（${s.channelName ?? s.channelCode}），请核对`);
    const p = prior(sid);
    const billed = r2(p.base + g.base.reduce((a, l) => a + l.amount, 0));
    const refunded = r2(p.cancel + g.cancel.reduce((a, l) => a + l.amount, 0));
    const st = STATUS_LABEL[s.status] ?? s.status;
    // 系统里已取消（或正在取消）的单：嘉谷不应该再收钱。只要还收着（扣的运费 + 补收 - 退回 > 0）就标出来，要和嘉谷核对
    const cancelled = s.status === "cancelled" || s.status === "cancel_requested";

    if (cancelled) {
      const extra = r2(p.extra + g.extra.reduce((a, l) => a + l.amount, 0));
      const net = r2(billed + extra + refunded);
      const sheets = [...new Set([...g.base, ...g.extra, ...g.cancel].map((l) => l.sheet))].join("、");
      if (net > 0.005) {
        const parts = [billed ? `运费 ${billed.toFixed(2)}` : "", extra ? `补收 ${extra.toFixed(2)}` : "", refunded ? `已退回 ${(-refunded).toFixed(2)}` : ""].filter(Boolean).join("，");
        issue("warn", "cancelled_charged", first, sid, s.customNo, net, `系统里「${st}」（客户已全额退款），但嘉谷还在收这一单的钱：${parts}，净收 ${net.toFixed(2)}。请和嘉谷核对`, sheets);
      } else if (billed > 0 || extra > 0) {
        resolved.push({ shipmentId: sid, note: `嘉谷账单已全部退回（扣 ${r2(billed + extra).toFixed(2)}，退 ${(-refunded).toFixed(2)}）` });
      }
      // 已取消的单：服务商实际收的取消费 = 扣的 - 退回的（对账用，客户不受影响；嘉谷之后退了，再导入时会更新）
      if (s.status === "cancelled" && (g.base.length || g.cancel.length)) {
        const fee = Math.max(0, r2(billed + refunded));
        if (Math.abs(fee - (s.sbCancelFee ?? 0)) >= 0.01) cancelFees.push({ shipmentId: sid, amount: fee });
      }
    } else if (g.cancel.length) {
      issue("warn", "refund_mismatch", first, sid, s.customNo, refunded, `账单里这单有取消退款 ${(-refunded).toFixed(2)}，但系统里是「${st}」，请核对`);
    }

    if (g.base.length && s.status === "labeled") {
      const cost = s.actualCost ?? s.quotedCost;
      const diff = r2(billed - cost - p.diff);
      if (Math.abs(diff) >= 0.01) {
        const detail = `账单 ${billed.toFixed(2)}（${g.base.flatMap((l) => l.fees.map((f) => `${f.name} ${f.amount.toFixed(2)}`)).join(" + ") || "—"}），下单时成本 ${cost.toFixed(2)}${p.diff ? `，之前已补 ${p.diff.toFixed(2)}` : ""}`;
        if (opts.baseDiff) {
          const fees = diff > 0 ? feeNames(g.base).filter((f) => f !== "运费") : [];
          const l = g.base[0];
          charges.push({
            sheet: l.sheet, kind: "base", tracking: l.tracking, refNo: l.refNo, shipmentId: sid, customNo: s.customNo, customerId: s.customerId, customerName: s.customerName ?? null,
            costAmount: diff, customerAmount: internal ? 0 : customerAmountFor(diff, policy, s.rule),
            reason: reasonText("base", fees, l.weight, l.dims, diff < 0), detail,
            weight: l.weight, dims: l.dims, product: l.product, shipDate: l.shipDate, zone: l.zone, sigs: g.base.map((x) => x.sig),
          });
        } else issue("info", "base_diff_off", g.base[0], sid, s.customNo, diff, `运费账单和下单成本差 ${diff.toFixed(2)}（${detail}），没有勾选“差额也补差”，不处理`);
      }
    } else if (g.base.length && !cancelled) {
      issue("warn", "status_mismatch", g.base[0], sid, s.customNo, billed, `账单扣了 ${billed.toFixed(2)}，但系统里这单是「${st}」，请核对（没有向客户收）`);
    }

    for (const l of g.extra) {
      if (legacy.has(`${normalizeTrackingKey(l.tracking || l.refNo)}|${l.amount.toFixed(2)}`) || legacy.has(`#${sid}|${l.amount.toFixed(2)}`)) {
        issue("info", "legacy_dup", l, sid, s.customNo, l.amount, "之前用补差表导入过同样金额的补差，跳过（不会重复收）");
        continue;
      }
      const ok = s.status === "labeled";
      // 已取消的单上面已经标了“已取消仍被收费”；其他状态（等待出单、异常）单独标
      if (!ok && !cancelled) issue("warn", "status_mismatch", l, sid, s.customNo, l.amount, `补收 ${l.amount.toFixed(2)}，但系统里这单是「${st}」，没有自动向客户收；需要的话导入后到补差批次里手动关联`);
      charges.push({
        sheet: l.sheet, kind: "extra", tracking: l.tracking, refNo: l.refNo,
        shipmentId: ok ? sid : null, customNo: ok ? s.customNo : null, customerId: ok ? s.customerId : null, customerName: ok ? s.customerName ?? null : null,
        costAmount: l.amount, customerAmount: ok && !internal ? customerAmountFor(l.amount, policy, s.rule) : 0,
        reason: reasonText("extra", feeNames([l]), l.weight, l.dims),
        detail: l.fees.map((f) => `${f.name} ${f.amount.toFixed(2)}`).join(" + "),
        weight: l.weight, dims: l.dims, product: l.product, shipDate: l.shipDate, zone: l.zone, sigs: [l.sig],
      });
    }
  }

  const sum = (xs: number[]) => r2(xs.reduce((a, b) => a + b, 0));
  return {
    sheets,
    summary: wb.summary,
    charges,
    issues: issues.sort((a, b) => (a.level === b.level ? 0 : a.level === "warn" ? -1 : 1)),
    notInSystem: { count: outside.length, total: sum(outside.map((l) => l.amount)), lines: outside },
    totals: {
      lines: lineCount,
      newLines: fresh.length + revised.length,
      alreadyImported: lineCount - fresh.length - revised.length,
      revised: revised.length,
      newBilled: sum(fresh.map((f) => f.line.amount)),
      matched: fresh.filter((f) => f.sid).length,
      costToBook: sum(charges.map((c) => c.costAmount)),
      customerTotal: sum(charges.map((c) => c.customerAmount)),
    },
    policy,
    policyLabel: ADJUSTMENT_POLICY_LABEL[policy],
    cancelFees,
    resolved,
    revisedSigs: revised.map((r) => r.line.sig),
  };
}

/* ---------------- 导入 ---------------- */

/** 补差批次里每一行的原始列（导出给客户时只留重量、尺寸、分区、日期这类白名单列） */
const BATCH_HEADER = ["运单号", "客户单号", "账单", "产品", "发货日期", "分区", "账单重量", "长×宽×高(in)", "服务商金额", "核对（账单 / 系统成本）"];

export function importGdeBill(filename: string, wb: GdeWorkbook, opts: GdeOptions) {
  const preview = buildGdePreview(wb, opts);
  if (!preview.totals.newLines) throw new Error("这个账单里的行都导入过了，没有新的内容");
  const conn = ensureTables();
  const latest = [...new Set(preview.sheets.filter((s) => s.newLines).map((s) => s.name.match(/^[\d.]+/)?.[0]).filter(Boolean))].pop();
  const byLineSig = new Map<string, number>(); // sig → charges 下标
  preview.charges.forEach((c, i) => c.sigs.forEach((s) => byLineSig.set(s, i)));

  const result = conn.transaction(() => {
    let batchId: number | null = null;
    const adjIds: number[] = [];
    if (preview.charges.length) {
      const rows: NewAdjustment[] = preview.charges.map((c, i) => ({
        rowNo: i + 1,
        matchKey: c.tracking || c.refNo,
        shipmentId: c.shipmentId,
        customerId: c.customerId,
        costAmount: c.costAmount,
        customerAmount: c.customerAmount,
        reason: c.reason,
        raw: [c.tracking, c.refNo, c.sheet, c.product, c.shipDate, c.zone, c.weight, c.dims.replace(/ in$/, ""), c.costAmount.toFixed(2), c.detail],
      }));
      const hash = createHash("sha256").update(`gde|${preview.charges.flatMap((c) => c.sigs).join("\n")}`).digest("hex");
      batchId = insertAdjustmentBatch({ filename, fileHash: hash, policy: preview.policy, note: `承运商账单${latest ? ` ${latest}` : ""}`, header: BATCH_HEADER }, rows);
      for (const a of listAdjustments({ batchId })) adjIds[a.rowNo - 1] = a.id;
    }
    const stats = { totals: preview.totals, sheets: preview.sheets.filter((s) => s.newLines), issues: preview.issues, notInSystem: { count: preview.notInSystem.count, total: preview.notInSystem.total }, summary: preview.summary, options: opts };
    const billId = Number(
      conn.prepare("INSERT INTO provider_bills (provider, filename, adjustment_batch_id, stats_json) VALUES ('jiagu', ?, ?, ?)").run(filename, batchId, JSON.stringify(stats)).lastInsertRowid,
    );
    const ins = conn.prepare(
      `INSERT OR IGNORE INTO provider_bill_lines (bill_id, provider, sig, sheet, kind, row_no, tracking, ref_no, order_no, amount, data_json, shipment_id, adjustment_id)
       VALUES (?, 'jiagu', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const linked = new Set<number>();
    const revisedSigs = new Set(preview.revisedSigs);
    for (const s of wb.sheets) {
      for (const l of s.lines) {
        const ci = byLineSig.get(l.sig);
        // 运费差额只挂在这一单的第一行上（之后再导入时按这个算已经补过多少）
        const adj = ci !== undefined && !linked.has(ci) ? adjIds[ci] ?? null : null;
        if (ci !== undefined) linked.add(ci);
        const sid = (findShipmentByKey(l.tracking) ?? findShipmentByKey(l.refNo) ?? findShipmentByKey(l.orderNo))?.id ?? null;
        ins.run(billId, l.sig, l.sheet, revisedSigs.has(l.sig) ? "revised" : l.kind, l.rowNo, l.tracking, l.refNo, l.orderNo, l.amount,
          JSON.stringify({ box: l.box, product: l.product, shipDate: l.shipDate, zone: l.zone, weight: l.weight, dims: l.dims, fees: l.fees }), sid, adj);
      }
    }
    // 已取消的单：记下服务商实收的取消费（对账用，客户不受影响）
    for (const f of preview.cancelFees) updateShipment(f.shipmentId, { sbCancelFee: f.amount });
    // 要核对的问题进“嘉谷账单待核对”：同一单同一类问题还没处理的，更新金额和说明，不重复加
    const findOpen = conn.prepare(
      "SELECT id FROM provider_bill_issues WHERE provider = 'jiagu' AND status = 'open' AND type = ? AND (shipment_id = ? OR (shipment_id IS NULL AND ? IS NULL AND tracking = ?))",
    );
    const upd = conn.prepare("UPDATE provider_bill_issues SET amount = ?, message = ?, sheet = ?, updated_at = datetime('now') WHERE id = ?");
    const add = conn.prepare(
      `INSERT INTO provider_bill_issues (bill_id, provider, type, shipment_id, tracking, order_no, ref_no, custom_no, sheet, amount, message)
       VALUES (?, 'jiagu', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const i of preview.issues.filter((x) => x.level === "warn")) {
      const hit = findOpen.get(i.type, i.shipmentId, i.shipmentId, i.tracking) as { id: number } | undefined;
      if (hit) upd.run(i.amount, i.message, i.sheet, hit.id);
      else add.run(billId, i.type, i.shipmentId, i.tracking, i.orderNo, i.refNo, i.customNo, i.sheet, i.amount, i.message);
    }
    // 之前标了“已取消仍被收费”、这次嘉谷已经全部退回的：自动标记已处理
    const done = conn.prepare(
      "UPDATE provider_bill_issues SET status = 'resolved', note = ?, resolved_at = datetime('now'), resolved_by = '系统（账单已退回）' WHERE provider = 'jiagu' AND status = 'open' AND type = 'cancelled_charged' AND shipment_id = ?",
    );
    for (const r of preview.resolved) done.run(r.note, r.shipmentId);
    return { billId, batchId };
  })();

  // 已关联的补差记入客户钱包（和补差表导入一样）
  if (result.batchId) {
    for (const a of listAdjustments({ batchId: result.batchId })) {
      if (a.shipmentId && a.customerId) postAdjustment(a.id, a.customerId, a.shipmentId, a.customerAmount, a.reason);
    }
  }
  return { ...result, preview };
}

/* ---------------- 导入记录 ---------------- */

export interface GdeBillRecord {
  id: number;
  filename: string;
  createdAt: string;
  adjustmentBatchId: number | null;
  stats: {
    totals: GdePreview["totals"];
    sheets: GdePreview["sheets"];
    issues: GdeIssue[];
    notInSystem: { count: number; total: number };
    summary: GdeSummary | null;
    options: GdeOptions;
  };
}

export function listGdeBills(limit = 30): GdeBillRecord[] {
  const conn = ensureTables();
  return (conn.prepare("SELECT * FROM provider_bills WHERE provider = 'jiagu' ORDER BY id DESC LIMIT ?").all(limit) as {
    id: number; filename: string; created_at: string; adjustment_batch_id: number | null; stats_json: string;
  }[]).map((r) => ({ id: r.id, filename: r.filename, createdAt: r.created_at, adjustmentBatchId: r.adjustment_batch_id, stats: JSON.parse(r.stats_json) }));
}

export function getGdeBill(id: number): GdeBillRecord | null {
  return listGdeBills(1000).find((b) => b.id === id) ?? null;
}

/** 撤销一次导入：删掉记下的行（之后可以重新导入）和对应的补差批次（客户钱包里的补差一起撤回） */
export function deleteGdeBill(id: number) {
  const conn = ensureTables();
  const b = conn.prepare("SELECT adjustment_batch_id FROM provider_bills WHERE id = ?").get(id) as { adjustment_batch_id: number | null } | undefined;
  if (!b) return;
  conn.transaction(() => {
    if (b.adjustment_batch_id) conn.prepare("DELETE FROM adjustment_batches WHERE id = ?").run(b.adjustment_batch_id);
    conn.prepare("DELETE FROM provider_bills WHERE id = ?").run(id);
  })();
}

/* ---------------- 嘉谷账单待核对 ---------------- */

export interface BillIssue {
  id: number;
  billId: number;
  type: GdeIssueType;
  shipmentId: number | null;
  tracking: string | null;
  orderNo: string | null;
  refNo: string | null;
  customNo: string | null;
  sheet: string | null;
  amount: number;
  message: string;
  status: "open" | "resolved";
  note: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  customerName: string | null;
  shipmentStatus: string | null;
}

export function listBillIssues(f: { status?: "open" | "resolved"; shipmentId?: number; limit?: number } = {}): BillIssue[] {
  const conn = ensureTables();
  const where = ["i.provider = 'jiagu'"];
  const args: (string | number)[] = [];
  if (f.status) { where.push("i.status = ?"); args.push(f.status); }
  if (f.shipmentId) { where.push("i.shipment_id = ?"); args.push(f.shipmentId); }
  const rows = conn
    .prepare(
      `SELECT i.*, c.name AS customer_name, s.status AS shipment_status FROM provider_bill_issues i
       LEFT JOIN shipments s ON s.id = i.shipment_id LEFT JOIN customers c ON c.id = s.customer_id
       WHERE ${where.join(" AND ")} ORDER BY CASE i.type WHEN 'cancelled_charged' THEN 0 ELSE 1 END, i.id DESC LIMIT ?`,
    )
    .all(...args, f.limit ?? 500) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as number, billId: r.bill_id as number, type: r.type as GdeIssueType, shipmentId: (r.shipment_id as number) ?? null,
    tracking: (r.tracking as string) ?? null, orderNo: (r.order_no as string) ?? null, refNo: (r.ref_no as string) ?? null, customNo: (r.custom_no as string) ?? null,
    sheet: (r.sheet as string) ?? null, amount: r.amount as number, message: r.message as string, status: r.status as BillIssue["status"], note: (r.note as string) ?? null,
    createdAt: r.created_at as string, updatedAt: r.updated_at as string, resolvedAt: (r.resolved_at as string) ?? null, resolvedBy: (r.resolved_by as string) ?? null,
    customerName: (r.customer_name as string) ?? null, shipmentStatus: (r.shipment_status as string) ?? null,
  }));
}

export function openBillIssueCount(): number {
  return (ensureTables().prepare("SELECT COUNT(*) AS n FROM provider_bill_issues WHERE provider = 'jiagu' AND status = 'open'").get() as { n: number }).n;
}

/** 标记已处理（和嘉谷沟通完、对方退款了或确认没问题），写一句处理结果 */
export function resolveBillIssue(id: number, note: string, by: string) {
  const r = ensureTables()
    .prepare("UPDATE provider_bill_issues SET status = 'resolved', note = ?, resolved_at = datetime('now'), resolved_by = ? WHERE id = ? AND status = 'open'")
    .run(note.trim().slice(0, 500) || null, by, id);
  if (!r.changes) throw new Error("这条已经处理过了，或者不存在");
}

/** 重新打开（标错了） */
export function reopenBillIssue(id: number) {
  ensureTables().prepare("UPDATE provider_bill_issues SET status = 'open', resolved_at = NULL, resolved_by = NULL WHERE id = ?").run(id);
}

/** 发给嘉谷的核对说明（已取消仍被收费的单），可以直接复制到微信 / 邮件 */
export function gdeDisputeText(issues: BillIssue[]): string {
  const list = issues.filter((i) => i.type === "cancelled_charged" && i.status === "open");
  if (!list.length) return "";
  const cid = getSettings().jiagu?.customerId;
  const total = r2(list.reduce((a, i) => a + i.amount, 0));
  return [
    `您好，以下 ${list.length} 单我们这边已经取消，但对账单里还在收费，麻烦帮忙核查并退款，谢谢！${cid ? `（客户 ID ${cid}）` : ""}`,
    ...list.map((i, n) => `${n + 1}. 运单号 ${i.tracking ?? "-"}；订单号 ${i.orderNo || "-"}；客户单号 ${i.refNo || i.customNo || "-"}；账单 ${i.sheet ?? "-"}；净收 ${i.amount.toFixed(2)} USD`),
    `合计 ${total.toFixed(2)} USD`,
  ].join("\n");
}
