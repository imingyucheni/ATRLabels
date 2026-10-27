import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-gdebill-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", country: "US", city: "Chino", address1: "1 Main St", zipCode: "91710", province: "CA", phone: "9095550100" },
  recipient: { nameFirst: "Jane", nameLast: "Roe", country: "US", city: "Austin", address1: "500 Congress Ave", zipCode: "78701", province: "TX", phone: "5125550100" },
  pkg: { length: 10, width: 8, height: 4, weight: 2, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "MUG", productNameCn: "杯子", productNameEn: "Mug", quantity: 1, declaredUnitPrice: 12, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 10, width: 8, height: 4, weight: 2, unit: 3 }],
};

const BASE_HEADER = ["客户名称", "订单号", "运单号", "客户单号", "产品名称", "发货时间", "分区代码", "重量(KG)", "计费重(KG)", "币种", "总金额", "运费", "燃油附加费", "签名费", "偏远费", "超偏远费", "超超偏远费", "住宅地址附加费"];
const EXTRA_HEADER = ["客户名称", "订单号", "运单号", "客户单号", "产品名称", "发货时间", "分区", "账单重量", "类型", "长INCH", "宽INCH", "高INCH", "币种", "总金额", "运费", "燃油附加费", "签名费", "偏远费", "超偏远费", "超超偏远费"];

type Line = { tracking: string; ref: string; total: number; fees: Record<string, number> };

/** 做一个和嘉谷对账单一样格式的工作簿：每张表一行表头、数据、最后一行合计；加一张汇总表 */
async function workbook(sheets: { name: string; kind: "base" | "extra"; lines: Line[] }[]) {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    const header = s.kind === "base" ? BASE_HEADER : EXTRA_HEADER;
    ws.addRow(header);
    for (const l of s.lines) {
      const row: (string | number)[] = header.map(() => 0);
      const set = (h: string, v: string | number) => (row[header.indexOf(h)] = v);
      set("客户名称", "Atronia Innovations Inc");
      set("订单号", `SMM${l.tracking.slice(-6)}`);
      set("运单号", l.tracking);
      set("客户单号", l.ref);
      set("产品名称", "GOFO-LAX-917(不预上网)");
      set("发货时间", "10/05/2026 23:43:37");
      if (s.kind === "base") {
        set("分区代码", 8); set("重量(KG)", 1.2); set("计费重(KG)", 1.2); set("币种", "USD");
      } else {
        set("分区", 8); set("账单重量", 5); set("类型", "LB"); set("长INCH", 12); set("宽INCH", 10); set("高INCH", 7); set("币种", "USD");
      }
      set("总金额", l.total);
      for (const [k, v] of Object.entries(l.fees)) set(k, v);
      ws.addRow(row);
    }
    const sumRow: (string | number | null)[] = header.map(() => null);
    sumRow[header.indexOf("总金额")] = Math.round(s.lines.reduce((a, l) => a + l.total, 0) * 100) / 100;
    ws.addRow(sumRow);
  }
  const sum = wb.addWorksheet("汇总表");
  sum.addRow(["汇总表", "汇总表", "汇总表", "汇总表", "汇总表"]);
  sum.addRow(["日期", "金额（USD）", "付款（USD）", "备注", "结余"]);
  sum.addRow(["期初余额"]);
  sum.addRow([sheets[0].name, 10, 500, "2026.10.1", 490]);
  sum.addRow(["待核销金额", 20.5, null, null, 19]);
  sum.addRow(["冻结金额", 7.25]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("嘉谷对账单导入", () => {
  let db: typeof import("@/lib/db");
  let svc: typeof import("@/lib/service");
  let ledger: typeof import("@/lib/ledger");
  let g: typeof import("@/lib/gdeBill");
  let cid: number;
  const ids: Record<string, number> = {};
  const ship = async (key: string, status: "labeled" | "cancelled" | "cancel_requested") => {
    const q = (await svc.quoteAll(cid, req)).find((x) => x.ok)!;
    const id = await svc.createLabel({ customerId: cid, channelCode: q.channelCode, req, expectedPrice: q.price!, waitForLabel: false });
    db.db().prepare("UPDATE shipments SET channel_code = 'JG-580914', channel_name = 'GOFO-LAX-917(不预上网) · GDE', tracking_no = ?, status = ?, quoted_cost = 5, actual_cost = NULL WHERE id = ?").run(`GFUS${key}`, status, id);
    ids[key] = id;
    return db.getShipment(id)!;
  };

  beforeAll(async () => {
    db = await import("@/lib/db");
    svc = await import("@/lib/service");
    ledger = await import("@/lib/ledger");
    g = await import("@/lib/gdeBill");
    await svc.syncChannels();
    cid = db.saveCustomer(null, { name: "账单客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(cid, db.listChannels().filter((c) => !c.code.startsWith("JG") && !c.code.startsWith("DHL") && !/HWT|MWT/.test(c.name)).map((c) => c.code));
    ledger.addLedger({ customerId: cid, type: "topup", amount: 200, createdBy: "admin" });
    await ship("A001", "labeled"); // 运费账单比成本多 1.20（燃油附加费）
    await ship("B002", "labeled"); // 运费对得上；另有补收 2.63
    await ship("C003", "cancelled"); // 已取消：扣 5.00、退 4.50
    await ship("D004", "cancelled"); // 已取消：扣了 6.00、还没退
  });

  type Sheet = { name: string; kind: "base" | "extra"; lines: Line[] };
  const week1 = (): Sheet[] => [
    { name: "10.19GOFO账单", kind: "base" as const, lines: [
      { tracking: "GFUSA001", ref: "ATR-A", total: 6.2, fees: { 运费: 5, 燃油附加费: 1.2 } },
      { tracking: "GFUSB002", ref: "ATR-B", total: 5, fees: { 运费: 5 } },
      { tracking: "GFUSC003", ref: "ATR-C", total: 5, fees: { 运费: 5 } },
      { tracking: "GFUSD004", ref: "ATR-D", total: 6, fees: { 运费: 6 } },
      { tracking: "GFUS999999", ref: "114-1234567-7654321", total: 3.43, fees: { 运费: 3.43 } },
      { tracking: "GFUS888888", ref: "ATR26100100000000", total: 2, fees: { 运费: 2 } },
    ] },
    { name: "10.19GOFO补收账单", kind: "extra" as const, lines: [{ tracking: "GFUSB002", ref: "ATR-B", total: 2.63, fees: { 超超偏远费: 2.63 } }] },
    { name: "10.19GOFO取消手续费", kind: "extra" as const, lines: [{ tracking: "GFUSC003", ref: "ATR-C", total: -4.5, fees: { 运费: -4.5 } }] },
  ];

  it("读出每张表的类型、金额和汇总表；不是嘉谷格式的返回 null", async () => {
    const wb = (await g.parseGdeWorkbook(await workbook(week1())))!;
    expect(wb.sheets.map((s) => [s.name, s.kind, s.lines.length, s.total, s.stated])).toEqual([
      ["10.19GOFO账单", "base", 6, 27.63, 27.63],
      ["10.19GOFO补收账单", "extra", 1, 2.63, 2.63],
      ["10.19GOFO取消手续费", "cancel", 1, -4.5, -4.5],
    ]);
    expect(wb.sheets[1].lines[0]).toMatchObject({ weight: "5 LB", dims: "12×10×7 in", fees: [{ name: "超超偏远费", amount: 2.63 }] });
    expect(wb.summary).toMatchObject({ paymentTotal: 500, balance: 490, extras: [{ label: "待核销金额", value: 20.5 }, { label: "冻结金额", value: 7.25 }] });
    const other = new ExcelJS.Workbook();
    other.addWorksheet("x").addRow(["单号", "金额"]);
    expect(await g.parseGdeWorkbook(Buffer.from(await other.xlsx.writeBuffer()))).toBeNull();
  });

  it("预览：运费差额和补收按加价比例记补差，已取消还被收费、找不到的单列出来核对", async () => {
    // 通用的补差转嫁设置是“按成本”，嘉谷账单照样按这一单的加价比例收
    db.saveSettings({ adjustmentPolicy: "at_cost" });
    const wb = (await g.parseGdeWorkbook(await workbook(week1())))!;
    const p = g.buildGdePreview(wb, { baseDiff: true });
    expect(p.totals).toMatchObject({ lines: 8, newLines: 8, alreadyImported: 0, matched: 6 });
    const a = p.charges.find((c) => c.tracking === "GFUSA001")!;
    expect(a).toMatchObject({ kind: "base", costAmount: 1.2, shipmentId: ids.A001 });
    // 按下单时的加价比例（5%）：1.20 → 1.26
    expect(a.customerAmount).toBe(1.26);
    expect(a.reason).toBe("承运商账单运费差额：燃油附加费（账单重量 1.2 KG）");
    const b = p.charges.find((c) => c.tracking === "GFUSB002")!;
    expect(b).toMatchObject({ kind: "extra", costAmount: 2.63, customerAmount: 2.77 });
    expect(b.reason).toBe("承运商账单补收：超超偏远费（账单重量 5 LB，尺寸 12×10×7 in）");
    // 客户看到的说明：不带服务商名称、不带成本金额
    for (const c of p.charges) expect(c.reason).not.toMatch(/嘉谷|GDE|SMM|\d+\.\d{2}/);
    expect(p.charges).toHaveLength(2);
    // 已取消的单只要嘉谷还收着钱就要核对：扣 5.00 退 4.50（还收 0.50）、扣 6.00 没退
    expect(p.issues.find((i) => i.shipmentId === ids.C003)).toMatchObject({ level: "warn", type: "cancelled_charged", amount: 0.5, orderNo: "SMMUSC003", message: expect.stringMatching(/已取消.*运费 5\.00，已退回 4\.50，净收 0\.50/) });
    expect(p.issues.find((i) => i.shipmentId === ids.D004)).toMatchObject({ level: "warn", type: "cancelled_charged", amount: 6, message: expect.stringMatching(/运费 6\.00，净收 6\.00/) });
    // 对账用：记下服务商实际收了多少（客户不受影响）
    expect(p.cancelFees).toEqual([{ shipmentId: ids.C003, amount: 0.5 }, { shipmentId: ids.D004, amount: 6 }]);
    expect(p.policyLabel).toMatch(/加价比例/);
    expect(p.issues.some((i) => i.level === "warn" && /本系统的格式/.test(i.message))).toBe(true);
    expect(p.notInSystem).toMatchObject({ count: 2, total: 5.43 });
    // 不勾选运费差额：只说明，不记
    const p2 = g.buildGdePreview(wb, { baseDiff: false });
    expect(p2.charges.map((c) => c.kind)).toEqual(["extra"]);
    expect(p2.issues.some((i) => i.shipmentId === ids.A001 && /没有勾选/.test(i.message))).toBe(true);
    const { translateMessage } = await import("@/lib/i18n");
    expect(translateMessage("en", b.reason)).toBe("Carrier bill surcharge: Remote area surcharge (billed weight 5 LB, size 12×10×7 in)");
    expect(translateMessage("en", a.reason)).toBe("Carrier bill postage difference: Fuel surcharge (billed weight 1.2 KG)");
  });

  it("导入：补差记入客户余额，已取消的记下取消费；同一个累计账单再导入时只处理新加的行；撤销后可以重新导入", async () => {
    const before = ledger.balanceOf(cid);
    const wb = (await g.parseGdeWorkbook(await workbook(week1())))!;
    const r = g.importGdeBill("Atronia-10.19.xlsx", wb, { baseDiff: true });
    expect(r.batchId).toBeTruthy();
    expect(ledger.balanceOf(cid)).toBeCloseTo(before - 1.26 - 2.77, 2);
    expect(db.getShipment(ids.C003)!.sbCancelFee).toBe(0.5);
    // 已取消还被收费的两单 + 找不到的一单进“嘉谷账单待核对”
    expect(g.openBillIssueCount()).toBe(3);
    const open = g.listBillIssues({ status: "open" });
    expect(open[0]).toMatchObject({ type: "cancelled_charged", customerName: "账单客户", shipmentStatus: "cancelled" });
    const text = g.gdeDisputeText(open);
    expect(text).toContain("运单号 GFUSC003；订单号 SMMUSC003；客户单号 ATR-C");
    expect(text).toContain("GFUSD004");
    expect(text).toContain("合计 6.50 USD");
    expect(g.listBillIssues({ status: "open", shipmentId: ids.D004 })).toHaveLength(1);
    const adj = db.listAdjustments({ batchId: r.batchId! });
    expect(adj.map((x) => [x.shipmentId, x.costAmount, x.customerAmount])).toEqual([[ids.A001, 1.2, 1.26], [ids.B002, 2.63, 2.77]]);
    expect(db.getAdjustmentBatch(r.batchId!)!.note).toBe("承运商账单 10.19");
    // 发给客户的补差明细：只有重量、尺寸、分区、日期这些列，没有服务商金额、账单表名、产品、核对说明
    const { customerAdjustmentSheet } = await import("@/lib/adjustmentExport");
    const sheet = customerAdjustmentSheet(r.batchId!, cid)!;
    expect(sheet.header.join(",")).not.toMatch(/服务商|账单,|产品|核对/);
    // 只补不退：明细的金额列标题不提“退还”
    expect(sheet.header.at(-1)).toBe("补收");
    expect(JSON.stringify(sheet.rows)).not.toMatch(/GOFO-LAX|10\.19GOFO|下单时成本/);
    expect(g.listGdeBills()[0]).toMatchObject({ id: r.billId, adjustmentBatchId: r.batchId });

    // 同一个文件再导入：都导入过了
    expect(() => g.importGdeBill("Atronia-10.19.xlsx", wb, { baseDiff: true })).toThrow(/都导入过了/);
    // 下一周的累计账单：前一周的表原样还在，新加一张补收表 → 只处理新的一行，A 的运费差额不会再记一次
    // 嘉谷这周把 D 的 6.00 退回了 → D 的核对自动标记已处理
    const next: Sheet[] = [
      ...week1(),
      { name: "10.27GOFO补收账单", kind: "extra", lines: [{ tracking: "GFUSA001", ref: "ATR-A", total: 0.53, fees: { 偏远费: 0.53 } }] },
      { name: "10.27GOFO取消手续费", kind: "extra", lines: [{ tracking: "GFUSD004", ref: "ATR-D", total: -6, fees: { 运费: -6 } }] },
    ];
    const wb2 = (await g.parseGdeWorkbook(await workbook(next)))!;
    const p = g.buildGdePreview(wb2, { baseDiff: true });
    expect(p.totals).toMatchObject({ newLines: 2, alreadyImported: 8 });
    expect(p.charges).toHaveLength(1);
    expect(p.charges[0]).toMatchObject({ kind: "extra", tracking: "GFUSA001", costAmount: 0.53 });
    expect(p.resolved).toEqual([{ shipmentId: ids.D004, note: expect.stringMatching(/全部退回/) }]);
    const r2 = g.importGdeBill("Atronia-10.27.xlsx", wb2, { baseDiff: true });
    expect(db.getAdjustmentBatch(r2.batchId!)!.note).toBe("承运商账单 10.27");
    expect(db.getShipment(ids.D004)!.sbCancelFee).toBe(0);
    expect(g.listBillIssues({ status: "open", shipmentId: ids.D004 })).toHaveLength(0);
    expect(g.listBillIssues({ status: "resolved" })[0]).toMatchObject({ shipmentId: ids.D004, resolvedBy: expect.stringMatching(/系统/) });
    expect(g.openBillIssueCount()).toBe(2);
    // 和嘉谷沟通完手动标记；标错了可以重新打开
    const c = g.listBillIssues({ status: "open", shipmentId: ids.C003 })[0];
    g.resolveBillIssue(c.id, "嘉谷说取消费 0.50 是合同规定的", "主管理员");
    expect(g.openBillIssueCount()).toBe(1);
    expect(() => g.resolveBillIssue(c.id, "again", "x")).toThrow(/处理过了/);
    g.reopenBillIssue(c.id);
    expect(g.openBillIssueCount()).toBe(2);

    // 撤销第一次导入：补差和客户余额里的补差一起撤回，可以重新导入
    const mid = ledger.balanceOf(cid);
    g.deleteGdeBill(r.billId);
    expect(db.getAdjustmentBatch(r.batchId!)).toBeFalsy();
    expect(ledger.balanceOf(cid)).toBeCloseTo(mid + 1.26 + 2.77, 2);
    const again = g.buildGdePreview(wb2, { baseDiff: true });
    expect(again.totals.newLines).toBe(8);
    // 第一次导入时标出来的核对一起删掉
    expect(g.openBillIssueCount()).toBe(0);
  });

  it("只补不退：嘉谷少收（运费账单比成本低、补收表里是负数）只记我们的成本，不退给客户，客户的补差明细里也没有", async () => {
    await ship("H008", "labeled");
    const before = ledger.balanceOf(cid);
    const wb = (await g.parseGdeWorkbook(await workbook([
      { name: "10.13GOFO账单", kind: "base", lines: [{ tracking: "GFUSH008", ref: "ATR-H", total: 4.2, fees: { 运费: 4.2 } }] },
      { name: "10.13GOFO补收账单", kind: "extra", lines: [{ tracking: "GFUSH008", ref: "ATR-H", total: -0.3, fees: { 运费: -0.3 } }] },
    ])))!;
    const p = g.buildGdePreview(wb, { baseDiff: true });
    expect(p.charges.map((c) => [c.kind, c.costAmount, c.customerAmount])).toEqual([["base", -0.8, 0], ["extra", -0.3, 0]]);
    expect(p.totals.customerTotal).toBe(0);
    const r = g.importGdeBill("10.13.xlsx", wb, { baseDiff: true });
    expect(ledger.balanceOf(cid)).toBeCloseTo(before, 2);
    const adj = db.listAdjustments({ batchId: r.batchId! });
    expect(adj.map((a) => [a.shipmentId, a.customerId, a.costAmount, a.customerAmount])).toEqual([[ids.H008, null, -0.8, 0], [ids.H008, null, -0.3, 0]]);
    // 客户那边看不到
    expect(db.listAdjustments({ customerId: cid }).some((a) => a.batchId === r.batchId)).toBe(false);
    const { customerAdjustmentSheet } = await import("@/lib/adjustmentExport");
    expect(customerAdjustmentSheet(r.batchId!, cid)!.rows.filter((x) => x.length > 2)).toHaveLength(1); // 只有合计行
  });

  it("只补不退之前导入的：可以一键撤回当时退给客户的补差，补收的不动", async () => {
    await ship("J009", "labeled");
    await ship("K010", "labeled");
    const wb = (await g.parseGdeWorkbook(await workbook([{ name: "10.14GOFO账单", kind: "base", lines: [
      { tracking: "GFUSJ009", ref: "ATR-J", total: 4.98, fees: { 运费: 4.98 } },
      { tracking: "GFUSK010", ref: "ATR-K", total: 5.5, fees: { 运费: 5.0, 燃油附加费: 0.5 } },
    ] }])))!;
    const r = g.importGdeBill("10.14.xlsx", wb, { baseDiff: true });
    // 模拟旧版本：嘉谷少收的 0.02 也退给了客户
    const neg = db.listAdjustments({ batchId: r.batchId! }).find((a) => a.costAmount < 0)!;
    db.db().prepare("UPDATE adjustments SET customer_id = ?, customer_amount = -0.02 WHERE id = ?").run(cid, neg.id);
    ledger.postAdjustment(neg.id, cid, ids.J009, -0.02, neg.reason);
    const charged = ledger.balanceOf(cid);
    expect(g.gdeCustomerRefunds(r.billId)).toEqual({ count: 1, total: -0.02 });
    expect(g.revokeGdeRefunds(r.billId)).toBe(1);
    expect(ledger.balanceOf(cid)).toBeCloseTo(charged - 0.02, 2);
    expect(g.gdeCustomerRefunds(r.billId)).toEqual({ count: 0, total: 0 });
    const after = db.listAdjustments({ batchId: r.batchId! });
    expect(after.find((a) => a.id === neg.id)).toMatchObject({ customerId: null, customerAmount: 0, costAmount: -0.02 });
    // 补收的那笔（K 的燃油附加费）不动
    expect(after.find((a) => a.shipmentId === ids.K010)).toMatchObject({ customerId: cid, costAmount: 0.5, customerAmount: 0.53 });
  });

  it("补传以前的文件：行都导入过了就跳过；同一张表里金额改过的不重复算，列出来核对", async () => {
    await ship("G007", "labeled");
    const v1: Sheet[] = [{ name: "10.12GOFO账单", kind: "base", lines: [{ tracking: "GFUSG007", ref: "ATR-G", total: 5, fees: { 运费: 5 } }, { tracking: "GFUS777777", ref: "114-0000000-0000000", total: 3, fees: { 运费: 3 } }] }];
    const wb1 = (await g.parseGdeWorkbook(await workbook(v1)))!;
    g.importGdeBill("10.12.xlsx", wb1, { baseDiff: true });
    // 再传一次（或者传更早的、内容一样的文件）：都导入过了
    expect(() => g.importGdeBill("10.12-again.xlsx", wb1, { baseDiff: true })).toThrow(/都导入过了/);
    // 嘉谷改过 10.12 这张表：G 从 5.00 改成 5.80 → 不当成新的一笔再加 5.80，也不自动补差，列出来核对
    const v2: Sheet[] = [{ name: "10.12GOFO账单", kind: "base", lines: [{ tracking: "GFUSG007", ref: "ATR-G", total: 5.8, fees: { 运费: 5.8 } }, v1[0].lines[1]] }];
    const wb2 = (await g.parseGdeWorkbook(await workbook(v2)))!;
    const p = g.buildGdePreview(wb2, { baseDiff: true });
    expect(p.totals).toMatchObject({ newLines: 1, revised: 1, alreadyImported: 1 });
    expect(p.charges).toEqual([]);
    expect(p.issues).toEqual([expect.objectContaining({ type: "bill_changed", shipmentId: ids.G007, amount: 5.8, message: expect.stringMatching(/以前 5\.00，这次 5\.80/) })]);
    g.importGdeBill("10.12-v2.xlsx", wb2, { baseDiff: true });
    expect(g.listBillIssues({ status: "open", shipmentId: ids.G007 })[0]).toMatchObject({ type: "bill_changed" });
    // 记成“改过”的行不算进运费合计：之后这一单的运费差额还是按 5.00 算
    const wb3 = (await g.parseGdeWorkbook(await workbook([{ name: "10.19GOFO补收账单", kind: "extra", lines: [{ tracking: "GFUSG007", ref: "ATR-G", total: 0.4, fees: { 偏远费: 0.4 } }] }])))!;
    expect(g.buildGdePreview(wb3, { baseDiff: true }).charges).toEqual([expect.objectContaining({ kind: "extra", costAmount: 0.4 })]);
    expect(() => g.importGdeBill("10.12-v2.xlsx", wb2, { baseDiff: true })).toThrow(/都导入过了/);
  });

  it("取消处理中（已向服务商申请取消）的单被收费：也要核对；同一单再出现只更新、不重复加", async () => {
    await ship("F006", "cancel_requested");
    const wb = (await g.parseGdeWorkbook(await workbook([{ name: "10.29GOFO账单", kind: "base", lines: [{ tracking: "GFUSF006", ref: "ATR-F", total: 4, fees: { 运费: 4 } }] }])))!;
    const p = g.buildGdePreview(wb, { baseDiff: true });
    expect(p.issues).toEqual([expect.objectContaining({ type: "cancelled_charged", shipmentId: ids.F006, amount: 4, message: expect.stringMatching(/取消处理中/) })]);
    expect(p.cancelFees).toEqual([]);
    expect(p.charges).toEqual([]);
    g.importGdeBill("f.xlsx", wb, { baseDiff: true });
    const wb2 = (await g.parseGdeWorkbook(await workbook([{ name: "10.30GOFO补收账单", kind: "extra", lines: [{ tracking: "GFUSF006", ref: "ATR-F", total: 1, fees: { 偏远费: 1 } }] }])))!;
    g.importGdeBill("f2.xlsx", wb2, { baseDiff: true });
    const open = g.listBillIssues({ status: "open", shipmentId: ids.F006 });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ amount: 5, message: expect.stringMatching(/运费 4\.00，补收 1\.00，净收 5\.00/) });
  });

  it("用通用补差表导入过的同一笔补收：不再重复记", async () => {
    const s = await ship("E005", "labeled");
    const { importAdjustments } = await import("@/lib/adjustments");
    importAdjustments("old.csv", [["运单号", "补差金额"], [s.trackingNo!, "1.11"]], { headerRow: 0, keyCol: 0, altKeyCol: -1, amountCol: 1, reasonCol: -1, positiveMeans: "charge" }, null);
    const wb = (await g.parseGdeWorkbook(await workbook([{ name: "10.30GOFO补收账单", kind: "extra", lines: [{ tracking: "GFUSE005", ref: "ATR-E", total: 1.11, fees: { 运费: 1.11 } }] }])))!;
    const p = g.buildGdePreview(wb, { baseDiff: true });
    expect(p.charges).toHaveLength(0);
    expect(p.issues.some((i) => /之前用补差表导入过/.test(i.message))).toBe(true);
  });
});

describe("嘉谷账单核对说明的英文", () => {
  it("已取消仍被收费 / 已全部退回", async () => {
    const { translateMessage } = await import("@/lib/i18n");
    expect(translateMessage("en", "系统里「已取消」（客户已全额退款），但嘉谷还在收这一单的钱：运费 5.00，已退回 4.50，净收 0.50。请和嘉谷核对"))
      .toBe("“Cancelled” in the system (customer fully refunded), but GDE is still charging for this order: Postage 5.00, refunded 4.50; net 0.50. Please check with GDE");
    expect(translateMessage("en", "嘉谷账单已全部退回（扣 6.00，退 6.00）")).toBe("Fully refunded in the GDE bill (charged 6.00, refunded 6.00)");
  });
});
