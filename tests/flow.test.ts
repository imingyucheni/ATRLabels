import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atr-test-"));
process.env.DATA_DIR = dir;
process.env.SHIPBEST_MOCK = "1";

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", country: "US", city: "Ontario", address1: "1 Main St", zipCode: "91761", province: "CA" },
  recipient: { nameFirst: "John", nameLast: "Doe", country: "US", city: "Austin", address1: "2 Elm St", zipCode: "73301", province: "TX" },
  pkg: { length: 10, width: 8, height: 4, weight: 2, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [
    { sku: "A1", productNameCn: "T恤", productNameEn: "T-shirt", quantity: 2, declaredUnitPrice: 5, declaredCurrency: "USD",
      hsCode: "610910", productNature: "2,4", length: 10, width: 8, height: 4, weight: 1, unit: 3 },
  ],
};

describe("模拟模式完整流程", () => {
  let db: typeof import("@/lib/db");
  let svc: typeof import("@/lib/service");

  beforeAll(async () => {
    db = await import("@/lib/db");
    svc = await import("@/lib/service");
    db.saveSettings({ markup: { percent: 5, fixed: 0, minProfit: 0 } });
    await svc.syncChannels();
  });

  it("校验必填字段", () => {
    const bad = { ...req, recipient: { ...req.recipient, zipCode: "", country: "USA" } };
    const errs = svc.validateRequest(bad);
    expect(errs).toContain("收件人邮编必填");
    expect(errs.some((e) => e.includes("二字码"))).toBe(true);
  });

  it("报价 → 出单 → 面单 → 取消", async () => {
    const custId = db.saveCustomer(null, { name: "测试客户", contact: null, phone: null, email: null, note: null, markup: { percent: 10 } });
    const quotes = await svc.quoteAll(custId, req);
    expect(quotes.length).toBe(3);
    const q = quotes[0];
    expect(q.ok).toBe(true);
    expect(q.rule!.percent).toBe(10); // 客户专属加价
    expect(q.price).toBeCloseTo(Math.ceil(q.cost! * 1.1 * 100 - 1e-6) / 100, 2);

    // 报价不一致会被拒绝
    await expect(svc.createLabel({ customerId: custId, channelCode: q.channelCode, req, expectedPrice: q.price! + 1 })).rejects.toThrow(/价格已变化/);

    const id = await svc.createLabel({ customerId: custId, channelCode: q.channelCode, req, expectedPrice: q.price! });
    const s = db.getShipment(id)!;
    expect(s.status).toBe("labeled");
    expect(s.trackingNo).toBeTruthy();
    expect(s.labelMime).toBe("application/pdf");
    expect(fs.readFileSync(path.join(dir, s.labelPath!)).subarray(0, 4).toString()).toBe("%PDF");
    expect(db.shipmentProfit(s)).toBeCloseTo(s.price - s.actualCost!, 2);

    // 已出面单：接口取消失败 → 标记处理中 → 人工确认
    const r = await svc.requestCancel(id);
    expect(r.done).toBe(false);
    expect(db.getShipment(id)!.status).toBe("cancel_requested");
    const fees = svc.defaultCancelFees(db.getShipment(id)!);
    expect(fees.cancelFee).toBeCloseTo(s.price * 0.1, 2);
    svc.confirmCancelled(id, fees.cancelFee, fees.sbCancelFee);
    const c = db.getShipment(id)!;
    expect(c.status).toBe("cancelled");
    expect(c.refundAmount).toBeCloseTo(s.price - fees.cancelFee, 2);
    expect(db.shipmentProfit(c)).toBeCloseTo(fees.cancelFee - fees.sbCancelFee, 2);
  }, 30_000);

  it("导入官方账单补差并计入客户对账单", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const adj = await import("@/lib/adjustments");
    const { buildStatement } = await import("@/lib/statement");
    const custId = db.saveCustomer(null, { name: "补差客户", contact: null, phone: null, email: null, note: null, markup: {} });
    const q = (await svc.quoteAll(custId, req))[0];
    const id = await svc.createLabel({ customerId: custId, channelCode: q.channelCode, req, expectedPrice: q.price! });
    const s = db.getShipment(id)!;

    // 模拟 ShipBest 给的表格：标题行 + 表头 + 数据 + 合计
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("补差");
    ws.addRow(["2026年9月官方账单补差"]);
    ws.addRow(["跟踪号", "预报重量", "实际重量", "补差金额", "原因"]);
    ws.addRow([s.trackingNo, 2, 3, 1.25, "重量差异"]);
    ws.addRow(["NOT-IN-SYSTEM", 1, 1, -0.4, "分区"]);
    ws.addRow(["合计", "", "", 0.85, ""]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const sheet = await adj.parseSheet("bill.xlsx", buf);
    expect(sheet.headerRow).toBe(1);
    const cols = adj.guessColumns(sheet.rows[sheet.headerRow]);
    const mapping = { headerRow: sheet.headerRow, ...cols, positiveMeans: "charge" as const };
    expect(cols.amountCol).toBe(3);
    const preview = adj.buildPreview(sheet.rows, mapping);
    expect(preview.rows.length).toBe(2); // 合计行被跳过
    expect(preview.unmatched).toBe(1);
    expect(preview.byCustomer).toEqual([{ customerId: custId, customerName: "补差客户", count: 1, costTotal: 1.25, customerTotal: 1.25 }]);

    const batchId = adj.importAdjustments("bill.xlsx", sheet.rows, mapping, null);
    expect(() => adj.importAdjustments("bill.xlsx", sheet.rows, mapping, null)).toThrow(/已经导入过/);
    // 同样内容重新另存（文件字节不同）也能识别
    const resaved = await adj.parseSheet("bill-copy.csv", Buffer.from(sheet.rows.map((r) => r.join(",")).join("\n")));
    expect(resaved.alreadyImported).toBe(true);

    const after = db.getShipment(id)!;
    expect(after.costAdj).toBe(1.25);
    expect(after.customerAdj).toBe(1.25);
    expect(db.shipmentProfit(after)).toBeCloseTo(s.price - s.actualCost!, 2); // 按原金额转嫁，利润不变

    const st = buildStatement(custId)!;
    expect(st.totals.adjustments).toBe(1.25);
    expect(st.totals.total).toBeCloseTo(s.price + 1.25, 2);

    // 再次预览会提示可能重复
    const again = adj.buildPreview(sheet.rows, mapping);
    expect(again.rows.find((r) => r.shipmentId)!.possibleDuplicate).toBe(true);

    // 撤销批次
    db.deleteAdjustmentBatch(batchId);
    expect(db.getShipment(id)!.costAdj).toBe(0);
  }, 30_000);
});
