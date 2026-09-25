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
  let ledger: typeof import("@/lib/ledger");

  beforeAll(async () => {
    db = await import("@/lib/db");
    svc = await import("@/lib/service");
    ledger = await import("@/lib/ledger");
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
    db.setCustomerChannels(custId, db.listChannels().map((c) => c.code));
    const quotes = await svc.quoteAll(custId, req);

    // 余额不足不能出单，也不留下任何记录
    const before = db.listShipments().length;
    await expect(svc.createLabel({ customerId: custId, channelCode: quotes[0].channelCode, req, expectedPrice: quotes[0].price! })).rejects.toThrow(/余额不足/);
    expect(db.listShipments().length).toBe(before);
    ledger.addLedger({ customerId: custId, type: "topup", amount: 100, createdBy: "admin" });
    expect(quotes.length).toBe(7);
    const q = quotes[0];
    expect(q.ok).toBe(true);
    expect(q.rule!.percent).toBe(10); // 客户专属加价
    expect(q.price).toBeCloseTo(Math.ceil(q.cost! * 1.1 * 100 - 1e-6) / 100, 2);

    // 报价不一致会被拒绝
    await expect(svc.createLabel({ customerId: custId, channelCode: q.channelCode, req, expectedPrice: q.price! + 1 })).rejects.toThrow(/价格已变化/);

    const id = await svc.createLabel({ customerId: custId, channelCode: q.channelCode, req, expectedPrice: q.price! });
    const s = db.getShipment(id)!;
    expect(s.status).toBe("labeled");
    expect(s.isTest).toBe(true); // 模拟模式下的单是测试单
    expect(s.trackingNo).toBeTruthy();
    expect(s.labelMime).toBe("application/pdf");
    expect(fs.readFileSync(path.join(dir, s.labelPath!)).subarray(0, 4).toString()).toBe("%PDF");
    expect(db.shipmentProfit(s)).toBeCloseTo(s.price - s.actualCost!, 2);
    expect(ledger.balanceOf(custId)).toBeCloseTo(100 - s.price, 2);

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
    // 退款回到钱包：只扣取消手续费
    expect(ledger.balanceOf(custId)).toBeCloseTo(100 - fees.cancelFee, 2);
    // 重复刷新不会重复退款
    await svc.refreshShipment(id).catch(() => null);
    expect(ledger.balanceOf(custId)).toBeCloseTo(100 - fees.cancelFee, 2);
  }, 30_000);

  it("导入官方账单补差并计入客户对账单", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const adj = await import("@/lib/adjustments");
    const { buildStatement } = await import("@/lib/statement");
    const custId = db.saveCustomer(null, { name: "补差客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(custId, db.listChannels().map((c) => c.code));
    ledger.addLedger({ customerId: custId, type: "topup", amount: 50, createdBy: "admin" });
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
    expect(preview.byCustomer).toEqual([{ customerId: custId, customerName: "补差客户", count: 1, costTotal: 1.25, customerTotal: 1.32 }]); // 默认按加价比例：1.25 × 1.05 = 1.3125 → 1.32
    expect(preview.rows.find((r) => r.shipmentId)!.markupPercent).toBe(5);

    const batchId = adj.importAdjustments("bill.xlsx", sheet.rows, mapping, null);
    expect(() => adj.importAdjustments("bill.xlsx", sheet.rows, mapping, null)).toThrow(/已经导入过/);
    // 同样内容重新另存（文件字节不同）也能识别
    const resaved = await adj.parseSheet("bill-copy.csv", Buffer.from(sheet.rows.map((r) => r.join(",")).join("\n")));
    expect(resaved.alreadyImported).toBe(true);

    const after = db.getShipment(id)!;
    expect(ledger.balanceOf(custId)).toBeCloseTo(50 - s.price - 1.32, 2); // 补差自动从钱包扣
    expect(after.costAdj).toBe(1.25);
    expect(after.customerAdj).toBe(1.32);
    expect(db.shipmentProfit(after)).toBeCloseTo(s.price - s.actualCost! + 0.07, 2); // 补差也赚加价部分

    const st = buildStatement(custId)!;
    expect(st.totals.adjustments).toBe(1.32);
    expect(st.totals.total).toBeCloseTo(s.price + 1.32, 2);

    // 再次预览会提示可能重复
    const again = adj.buildPreview(sheet.rows, mapping);
    expect(again.rows.find((r) => r.shipmentId)!.possibleDuplicate).toBe(true);

    // 撤销批次
    db.deleteAdjustmentBatch(batchId);
    expect(db.getShipment(id)!.costAdj).toBe(0);
    expect(ledger.balanceOf(custId)).toBeCloseTo(50 - s.price, 2); // 撤销批次，扣款一起撤回
  }, 30_000);

  it("批量下单：ShipBest 导单模板 → 多渠道试算 → 逐单选渠道 → 提交勾选 → 面单 → 合并打印", async () => {
    const batch = await import("@/lib/batch");
    const { readSheetRows } = await import("@/lib/adjustments");
    const { mergeLabels } = await import("@/lib/mergeLabels");
    const { PDFDocument } = await import("pdf-lib");
    const ExcelJS = (await import("exceljs")).default;
    const wait = async (id: number, st: string[]) => {
      for (let i = 0; i < 150; i++) {
        const j = batch.getJob(id)!;
        if (st.includes(j.status)) return j;
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error("timeout " + batch.getJob(id)!.status);
    };
    const custId = db.saveCustomer(null, { name: "批量客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(custId, db.listChannels().map((c) => c.code));

    // 0) 下载的模板第一个工作表只有表头，原样上传不会下单
    const blank = batch.parseOrders(await readSheetRows("t.xlsx", await batch.buildTemplate(req.sender), "first"), null);
    expect(blank.error).toContain("没有订单数据");

    // 0.1) 服务商格式的写法：in/oz 换算成磅、商品性质写中文、示例行跳过
    const wb0 = new ExcelJS.Workbook();
    const w0 = wb0.addWorksheet("导入模板");
    w0.addRow(batch.SHIPBEST_HEADERS);
    const rec = ["Doe", "Jane", "512-555-0100", "US", "TX", "Austin", null, "78701", null, "1 Test St"];
    const snd = ["House", "Ware", "6265550100", "US", "CA", "Chino", null, "91710", null, "1 Warehouse Way"];
    const line = (ref: string, unit: string, wt: number, nature: string) =>
      [ref, null, "不需要", null, "不需要", 10, 8, 4, wt, unit, null, "S1", "T恤", "T-shirt", 1, 5, wt, unit, null, null, null, null, nature,
        ...rec, null, null, null, null, null, ...snd];
    w0.addRow(line(batch.EXAMPLE_REF, "cm/g", 900, "带磁"));
    w0.addRow([...Array(11).fill(null), "EX-SKU", "帽子", "Cap", 1, 5, 100, "cm/g"]); // 示例的续行也跳过
    w0.addRow(line("R-OZ", "in/oz", 32, "不带磁,不带电"));
    w0.addRow(line("R-LB", "in/lb", 2, "带电"));
    const p0 = batch.parseOrders(await readSheetRows("x.xlsx", Buffer.from(await wb0.xlsx.writeBuffer()), "first"), null);
    expect(p0.orders.map((o) => o.customerRef)).toEqual(["R-OZ", "R-LB"]);
    expect(p0.orders[0].req.pkg).toMatchObject({ weight: 2, displayUnitSystem: 3 });
    expect(p0.orders[0].req.skuList[0]).toMatchObject({ weight: 2, unit: 3, productNature: "2,4" });
    expect(p0.orders[0].req.skuList).toHaveLength(1);
    expect(p0.orders[1].req.skuList[0].productNature).toBe("2,3");

    // 1) 示例格式可以直接上传：3 行示例 = 2 单（A1001 两个 SKU）
    const tplRows = await readSheetRows("t.xlsx", await batch.buildTemplate(req.sender, { examplesInFirstSheet: true }), "first");
    const t = batch.parseOrders(tplRows, null);
    expect(t.error).toBeUndefined();
    expect(t.orders.map((o) => o.customerRef)).toEqual(["A1001", "A1002"]);
    expect(t.orders[0].req.skuList.map((s) => s.sku)).toEqual(["TS-001", "CAP-02"]);
    expect(t.orders[1].req.pkg.displayUnitSystem).toBe(3);
    expect(t.orders.every((o) => o.errors.length === 0)).toBe(true);

    // 2) 和客户实际导单表同样结构的数据（空 HS CODE、电话带空格、ZIP+4、数字邮编、cm/g、表格里有寄件人）
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("导入模板");
    ws.addRow(batch.SHIPBEST_HEADERS);
    const senderCols = ["Warehouse", "Test", 6265550100, "US", "CA", "Chino", null, 91710, null, "1 Warehouse Way", null, null, null, null, null];
    const order = (ref: string, l: number, w: number, h: number, g: number, last: string, first: string, st: string, city: string, zip: string | number, a1: string) =>
      [ref, "UniUni-（91710）", "不需要", null, "不需要", l, w, h, g, "cm/g", null, `SKU-${ref}`, "面条", "Noodles", 1, 15, g, "cm/g", null, null, null, null, null,
        last, first, " 346-555-0143 ", "US", st, city, null, zip, null, a1, null, null, null, null, null, ...senderCols, null, 15];
    ws.addRow(order("114-0000001-0000001", 21, 14, 14, 450, "Doe", "Jane", "DC", "WASHINGTON", "20001-0001", "1 TEST ST"));
    ws.addRow(order("114-0000002-0000002", 22, 8, 8, 700, "Roe", "Richard", "OR", "SALEM", "97301-0001", "2 TEST AVE"));
    ws.addRow(order("111-0000003-0000003", 26, 7, 7, 450, "Smith", "Alex", "FL", "Miami", 33101, "3 TEST RD"));
    ws.addRow([...Array(11).fill(null), "EXTRA-SKU", "筷子", "Chopsticks", 2, 3, 50, "cm/g"]); // 第 3 单的第二个 SKU
    ws.addRow(order("111-0000004-0000004", 22, 8, 8, 600, "Lee", "Sam", "MN", "MINNEAPOLIS", "", "4 TEST LN")); // 缺邮编
    const rows = await readSheetRows("24-0924.xlsx", Buffer.from(await wb.xlsx.writeBuffer()), "first");
    const parsed = batch.parseOrders(rows, null);
    expect(parsed.error).toBeUndefined();
    expect(parsed.orders.length).toBe(4);
    const [o1, , o3, o4] = parsed.orders;
    expect(o1.req.recipient).toMatchObject({ nameLast: "Doe", nameFirst: "Jane", phone: "346-555-0143", zipCode: "20001-0001", province: "DC" });
    expect(o1.req.sender).toMatchObject({ nameFirst: "Test", city: "Chino", zipCode: "91710" });
    expect(o1.req.pkg).toMatchObject({ length: 21, width: 14, height: 14, weight: 450, displayUnitSystem: 1, signServiceType: 0, insuranceService: 0 });
    expect(o1.fileChannel).toBe("UniUni-（91710）");
    expect(o1.errors).toEqual([]);
    expect(o3.req.recipient.zipCode).toBe("33101");
    expect(o3.req.skuList.map((s) => s.sku)).toEqual(["SKU-111-0000003-0000003", "EXTRA-SKU"]);
    expect(o4.errors).toContain("收件人邮编必填");

    // 3) 3 个渠道逐单试算，默认选最便宜
    const jobId = batch.createJob({ customerId: custId, createdBy: "customer", filename: "24-0924.xlsx", channels: ["LP10210030", "LP10210028", "LP10210029"], pickMode: "cheapest", orders: parsed.orders });
    batch.ensureRunning(jobId);
    let job = await wait(jobId, ["ready"]);
    const q = job.rows.filter((r) => r.status === "quoted");
    expect(q.length).toBe(3);
    expect(job.rows.find((r) => r.status === "error")!.error).toContain("邮编");
    for (const r of q) {
      expect(r.quotes.length).toBe(3);
      expect(r.price).toBe(Math.min(...r.quotes.map((x) => x.price!)));
    }

    // 4) 单独改第一单的渠道；批量改第三单的渠道；取消勾选第二单
    batch.chooseRowChannel(jobId, q[0].id, "LP10210028");
    expect(batch.getJob(jobId)!.rows.find((r) => r.id === q[0].id)!.channelCode).toBe("LP10210028");
    expect(batch.chooseAll(jobId, "LP10210029", [q[2].id])).toEqual({ changed: 1, skipped: 0 });
    batch.setSelected(jobId, [q[0].id, q[2].id]);
    expect(() => batch.chooseRowChannel(jobId, q[0].id, "NOPE")).toThrow(/没有报价/);

    // 5) 只用 2 个渠道重新试算：第一单已选的渠道保留；第三单选的渠道不在试算范围 → 改为最便宜
    batch.requote(jobId, ["LP10210030", "LP10210028"]);
    job = await wait(jobId, ["ready"]);
    const rq = (id: number) => job.rows.find((r) => r.id === id)!;
    expect(rq(q[0].id).quotes.length).toBe(2);
    expect(rq(q[0].id).channelCode).toBe("LP10210028");
    const r3 = rq(q[2].id);
    expect(r3.price).toBe(Math.min(...r3.quotes.filter((x) => x.ok).map((x) => x.price!)));

    // 6) 提交勾选的 2 单
    ledger.addLedger({ customerId: custId, type: "topup", amount: 100, createdBy: "admin" });
    batch.confirmJob(jobId);
    job = await wait(jobId, ["ready", "done"]);
    const created = job.rows.filter((r) => r.status === "created");
    expect(created.map((r) => r.id).sort()).toEqual([q[0].id, q[2].id].sort());
    expect(job.status).toBe("ready"); // 第二单还没提交，可以继续
    expect(created.every((r) => r.hasLabel && r.trackingNo)).toBe(true);
    const shipment = db.getShipment(created[0].shipmentId!)!;
    expect(shipment.customerRef).toBe(created[0].customerRef);
    expect(shipment.channelCode).toBe(rq(created[0].id).channelCode);
    expect(shipment.createdBy).toBe("customer");
    expect(ledger.balanceOf(custId)).toBeCloseTo(100 - created.reduce((a, r) => a + r.price!, 0), 2);

    // 7) 再提交剩下的一单
    batch.setSelected(jobId, "all");
    batch.confirmJob(jobId);
    job = await wait(jobId, ["done"]);
    expect(job.rows.filter((r) => r.status === "created").length).toBe(3);

    const pdf = await mergeLabels(job.rows.filter((r) => r.shipmentId).map((r) => db.getShipment(r.shipmentId!)!));
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(3);

    // 8) 同一张表再导一次：已出过面单的订单号标记“可能重复”，默认不勾选
    const again = batch.createJob({ customerId: custId, createdBy: "customer", filename: "24-0924.xlsx", channels: ["LP10210028"], pickMode: "cheapest", orders: parsed.orders });
    batch.ensureRunning(again);
    const j2 = await wait(again, ["ready"]);
    const dupRows = j2.rows.filter((r) => r.status === "quoted");
    expect(dupRows.length).toBe(3);
    expect(dupRows.every((r) => r.warning?.includes("已经出过面单") && !r.selected)).toBe(true);
    expect(() => batch.confirmJob(again)).toThrow(/勾选/);
  }, 90_000);

  it("批量下单：余额不足自动暂停，充值后继续", async () => {
    const batch = await import("@/lib/batch");
    const { readSheetRows } = await import("@/lib/adjustments");
    const wait = async (id: number, st: string[]) => {
      for (let i = 0; i < 150; i++) {
        const j = batch.getJob(id)!;
        if (st.includes(j.status)) return j;
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error("timeout");
    };
    // “必须够付这一单”规则
    db.saveSettings({ balanceRule: "cover" });
    const custId = db.saveCustomer(null, { name: "余额客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(custId, db.listChannels().map((c) => c.code));
    const rows = await readSheetRows("t.xlsx", await batch.buildTemplate(req.sender, { examplesInFirstSheet: true }), "first");
    const jobId = batch.createJob({ customerId: custId, createdBy: "admin", filename: "t.xlsx", channels: ["LP10210030"], pickMode: "cheapest", orders: batch.parseOrders(rows, null).orders });
    batch.ensureRunning(jobId);
    let job = await wait(jobId, ["ready"]);
    ledger.addLedger({ customerId: custId, type: "topup", amount: job.rows[0].price! + 0.01, createdBy: "admin" });
    batch.confirmJob(jobId);
    job = await wait(jobId, ["ready", "done"]);
    expect(job.error).toContain("余额不足");
    expect(job.rows.filter((r) => r.status === "created").length).toBe(1);
    ledger.addLedger({ customerId: custId, type: "topup", amount: 100, createdBy: "admin" });
    batch.confirmJob(jobId);
    job = await wait(jobId, ["done"]);
    expect(job.rows.every((r) => r.status === "created")).toBe(true);
    db.saveSettings({ balanceRule: "positive" });
  }, 60_000);

  it("余额规则：余额大于 0 就能下单（可变负），余额 ≤ 0 必须充值；信用额度", async () => {
    const { canAfford } = await import("@/lib/ledger");
    // 规则本身
    expect(canAfford(0.01, 0, 10, "positive")).toBe(true);
    expect(canAfford(0, 0, 10, "positive")).toBe(false);
    expect(canAfford(-5, 0, 1, "positive")).toBe(false);
    expect(canAfford(-5, 100, 10, "positive")).toBe(true);
    expect(canAfford(5, 0, 10, "cover")).toBe(false);
    expect(canAfford(5, 10, 10, "cover")).toBe(true);

    db.saveSettings({ balanceRule: "positive" });
    const custId = db.saveCustomer(null, { name: "透支客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(custId, db.listChannels().map((c) => c.code));
    ledger.addLedger({ customerId: custId, type: "topup", amount: 1, createdBy: "admin" });
    const q = (await svc.quoteAll(custId, req))[0];
    // 余额 1，运费约 6：可以下单，余额变负
    await svc.createLabel({ customerId: custId, channelCode: q.channelCode, req, expectedPrice: q.price! });
    expect(ledger.balanceOf(custId)).toBeLessThan(0);
    // 余额为负：必须充值
    await expect(svc.createLabel({ customerId: custId, channelCode: q.channelCode, req, expectedPrice: q.price! })).rejects.toThrow(/需要先充值/);
    ledger.addLedger({ customerId: custId, type: "topup", amount: 10, createdBy: "admin" });
    await svc.createLabel({ customerId: custId, channelCode: q.channelCode, req, expectedPrice: q.price! });
  }, 60_000);

  it("面单加印：全局开关、客户单独设置、渠道位置、原始面单不变", async () => {
    const { stampFor, stampedLabel } = await import("@/lib/stamp");
    const { readLabel } = await import("@/lib/labels");
    const custId = db.saveCustomer(null, { name: "加印客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(custId, db.listChannels().map((c) => c.code));
    ledger.addLedger({ customerId: custId, type: "topup", amount: 50, createdBy: "admin" });
    const q = (await svc.quoteAll(custId, req))[0];
    const id = await svc.createLabel({ customerId: custId, channelCode: q.channelCode, req, expectedPrice: q.price! });
    const s = db.getShipment(id)!;
    const original = readLabel(s.labelPath!);

    // 默认关闭
    expect(stampFor(s)).toBeNull();
    expect(await stampedLabel(s)).toBeNull();
    // 全局开启
    db.saveSettings({ stamp: { ...db.getSettings().stamp, enabled: true } });
    expect(stampFor(s)).not.toBeNull();
    const stamped = await stampedLabel(s);
    expect(stamped).not.toBeNull();
    expect(Buffer.compare(readLabel(s.labelPath!), original)).toBe(0); // 原文件没动
    // 客户单独关闭
    db.setCustomerStampMode(custId, "off");
    expect(stampFor(db.getShipment(id)!)).toBeNull();
    // 客户单独开启 + 全局关闭 + 渠道位置覆盖
    db.saveSettings({ stamp: { ...db.getSettings().stamp, enabled: false } });
    db.setCustomerStampMode(custId, "on");
    db.setChannelStamp(q.channelCode, { y: 1.2, fontSize: 14 });
    const cfg = stampFor(db.getShipment(id)!)!;
    expect(cfg.y).toBe(1.2);
    expect(cfg.fontSize).toBe(14);
    expect(cfg.x).toBe(db.getSettings().stamp.x);
    // 渠道单独不加印（例如 ShipBest 已在备注里印了 SKU）→ 即使客户开启也不加印
    db.setChannelStamp(q.channelCode, { enabled: false });
    expect(stampFor(db.getShipment(id)!)).toBeNull();
    // 渠道单独加印：全局关闭、客户跟随全局时也加印
    db.setCustomerStampMode(custId, "inherit");
    db.setChannelStamp(q.channelCode, { enabled: true, y: 5.3 });
    expect(stampFor(db.getShipment(id)!)!.y).toBe(5.3);
    // 客户明确不加印优先
    db.setCustomerStampMode(custId, "off");
    expect(stampFor(db.getShipment(id)!)).toBeNull();
    // 单独填写的文字
    db.setLabelNote(id, "PICK: A-01");
    expect(db.getShipment(id)!.labelNote).toBe("PICK: A-01");
  }, 30_000);
});

describe("按客户开通渠道", () => {
  it("新客户默认没有渠道；只能用开通的渠道试算和下单", async () => {
    const db = await import("@/lib/db");
    const svc = await import("@/lib/service");
    const ledger = await import("@/lib/ledger");
    await svc.syncChannels();
    const id = db.saveCustomer(null, { name: "渠道客户", contact: null, phone: null, email: null, note: null, markup: {} });
    ledger.addLedger({ customerId: id, type: "topup", amount: 100, createdBy: "admin" });
    expect(db.customerChannels(id)).toHaveLength(0);
    await expect(svc.quoteAll(id, req)).rejects.toThrow("还没有开通任何物流渠道");

    const [first, second] = db.listChannels(true);
    db.setCustomerChannels(id, [first.code, "NOT_A_CHANNEL"]);
    expect(db.customerChannelCodes(id)).toEqual([first.code]);
    const quotes = await svc.quoteAll(id, req);
    expect(quotes.map((q) => q.channelCode)).toEqual([first.code]);

    const denied = await svc.quoteChannel(id, second.code, req);
    expect(denied.ok).toBe(false);
    await expect(svc.createLabel({ customerId: id, channelCode: second.code, req, expectedPrice: 1 })).rejects.toThrow("未开通此渠道");

    // 渠道在设置里全局停用后，已开通的客户也不能用
    db.updateChannel(first.code, false, {});
    expect(db.customerChannels(id)).toHaveLength(0);
    db.updateChannel(first.code, true, {});
  });
});
