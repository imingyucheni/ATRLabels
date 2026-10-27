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
  const ship = async (key: string, status: "labeled" | "cancelled") => {
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

  it("预览：运费差额和补收记补差，已取消被扣费、找不到的单列出来核对", async () => {
    const wb = (await g.parseGdeWorkbook(await workbook(week1())))!;
    const p = g.buildGdePreview(wb, { baseDiff: true });
    expect(p.totals).toMatchObject({ lines: 8, newLines: 8, alreadyImported: 0, matched: 6 });
    const a = p.charges.find((c) => c.tracking === "GFUSA001")!;
    expect(a).toMatchObject({ kind: "base", costAmount: 1.2, shipmentId: ids.A001 });
    // 默认按加价比例转嫁（5%）：1.20 → 1.26
    expect(a.customerAmount).toBe(1.26);
    expect(a.reason).toBe("承运商账单运费差额：燃油附加费（账单重量 1.2 KG）");
    const b = p.charges.find((c) => c.tracking === "GFUSB002")!;
    expect(b).toMatchObject({ kind: "extra", costAmount: 2.63, customerAmount: 2.77 });
    expect(b.reason).toBe("承运商账单补收：超超偏远费（账单重量 5 LB，尺寸 12×10×7 in）");
    // 客户看到的说明：不带服务商名称、不带成本金额
    for (const c of p.charges) expect(c.reason).not.toMatch(/嘉谷|GDE|SMM|\d+\.\d{2}/);
    expect(p.charges).toHaveLength(2);
    // 已取消：扣 5.00 退 4.50 → 服务商实收取消费 0.50；扣了没退的要核对
    expect(p.cancelFees).toEqual([{ shipmentId: ids.C003, amount: 0.5 }]);
    expect(p.issues.find((i) => i.shipmentId === ids.D004)).toMatchObject({ level: "warn", message: expect.stringMatching(/已取消.*扣了 6\.00.*还没有退回/) });
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
    const adj = db.listAdjustments({ batchId: r.batchId! });
    expect(adj.map((x) => [x.shipmentId, x.costAmount, x.customerAmount])).toEqual([[ids.A001, 1.2, 1.26], [ids.B002, 2.63, 2.77]]);
    expect(db.getAdjustmentBatch(r.batchId!)!.note).toBe("承运商账单 10.19");
    // 发给客户的补差明细：只有重量、尺寸、分区、日期这些列，没有服务商金额、账单表名、产品、核对说明
    const { customerAdjustmentSheet } = await import("@/lib/adjustmentExport");
    const sheet = customerAdjustmentSheet(r.batchId!, cid)!;
    expect(sheet.header.join(",")).not.toMatch(/服务商|账单,|产品|核对/);
    expect(JSON.stringify(sheet.rows)).not.toMatch(/GOFO-LAX|10\.19GOFO|下单时成本/);
    expect(g.listGdeBills()[0]).toMatchObject({ id: r.billId, adjustmentBatchId: r.batchId });

    // 同一个文件再导入：都导入过了
    expect(() => g.importGdeBill("Atronia-10.19.xlsx", wb, { baseDiff: true })).toThrow(/都导入过了/);
    // 下一周的累计账单：前一周的表原样还在，新加一张补收表 → 只处理新的一行，A 的运费差额不会再记一次
    const next: Sheet[] = [...week1(), { name: "10.27GOFO补收账单", kind: "extra", lines: [{ tracking: "GFUSA001", ref: "ATR-A", total: 0.53, fees: { 偏远费: 0.53 } }] }];
    const wb2 = (await g.parseGdeWorkbook(await workbook(next)))!;
    const p = g.buildGdePreview(wb2, { baseDiff: true });
    expect(p.totals).toMatchObject({ newLines: 1, alreadyImported: 8 });
    expect(p.charges).toHaveLength(1);
    expect(p.charges[0]).toMatchObject({ kind: "extra", tracking: "GFUSA001", costAmount: 0.53 });
    const r2 = g.importGdeBill("Atronia-10.27.xlsx", wb2, { baseDiff: true });
    expect(db.getAdjustmentBatch(r2.batchId!)!.note).toBe("承运商账单 10.27");

    // 撤销第一次导入：补差和客户余额里的补差一起撤回，可以重新导入
    const mid = ledger.balanceOf(cid);
    g.deleteGdeBill(r.billId);
    expect(db.getAdjustmentBatch(r.batchId!)).toBeFalsy();
    expect(ledger.balanceOf(cid)).toBeCloseTo(mid + 1.26 + 2.77, 2);
    const again = g.buildGdePreview(wb2, { baseDiff: true });
    expect(again.totals.newLines).toBe(8);
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
