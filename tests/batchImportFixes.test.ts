import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-batchfix-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

const sender = { nameFirst: "Ware", nameLast: "House", country: "US", province: "CA", city: "Chino", address1: "13950 Central Ave", zipCode: "91710", phone: "9095550100" };

/** 一行导单表（55 列），收件人可以改 */
function line(ref: string | null, o: { channel?: string; country?: string; st?: string; city?: string; zip?: string | number; a1?: string; a2?: string } = {}) {
  return [
    ref, o.channel ?? null, "不需要", null, "不需要", 10, 8, 4, 2, "in/lb", null, `SKU-${ref}`, "杯子", "Mug", 1, 12, 2, "in/lb", null, null, null, null, null,
    "Doe", "Jane", "512-555-0100", o.country ?? "US", o.st ?? "TX", o.city ?? "Austin", null, o.zip ?? "78701", null, o.a1 ?? "500 Congress Ave", o.a2 ?? null,
  ];
}

const req = (zip = "78701", ref = ""): ShipmentRequest => ({
  sender,
  recipient: { nameFirst: "Jane", nameLast: "Doe", country: "US", province: "TX", city: "Austin", address1: "500 Congress Ave", zipCode: zip, phone: "5125550100" },
  pkg: { length: 10, width: 8, height: 4, weight: 2, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: `SKU-${ref || "X"}`, productNameCn: "杯子", productNameEn: "Mug", quantity: 1, declaredUnitPrice: 12, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 10, width: 8, height: 4, weight: 2, unit: 3 }],
});

describe("批量导入：行号、邮编、国际件、表格渠道、运费变化、关联已建好的单", () => {
  let db: typeof import("@/lib/db");
  let batch: typeof import("@/lib/batch");
  let svc: typeof import("@/lib/service");
  let ledger: typeof import("@/lib/ledger");
  let cid: number;

  const wait = async (id: number, st: string[]) => {
    for (let i = 0; i < 200; i++) {
      const j = batch.getJob(id)!;
      if (st.includes(j.status)) return j;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("timeout " + batch.getJob(id)!.status);
  };

  /** 按行号写表格（中间可以留空行） */
  async function xlsx(rows: Record<number, unknown[]>) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("导入模板");
    for (const [n, vals] of Object.entries(rows)) vals.forEach((v, i) => v !== null && v !== undefined && (ws.getRow(Number(n)).getCell(i + 1).value = v as never));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  beforeAll(async () => {
    db = await import("@/lib/db");
    batch = await import("@/lib/batch");
    svc = await import("@/lib/service");
    ledger = await import("@/lib/ledger");
    db.saveSettings({ sender });
    await svc.syncChannels();
    cid = db.saveCustomer(null, { name: "批量修复客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(cid, ["LP10210028", "LP10210029", "LP10210030"]);
    ledger.addLedger({ customerId: cid, type: "topup", amount: 500, createdBy: "admin" });
  });

  it("报错里的行号就是表格里的行号（中间有空行时也对）：xlsx", async () => {
    const buf = await xlsx({
      1: batch.SHIPBEST_HEADERS,
      2: line("ROW-2"),
      // 第 3、4 行空着
      5: line("ROW-5", { zip: "" }), // 缺邮编
      6: line(null).map((v, i) => (i >= 11 && i <= 17 ? v : null)), // ROW-5 的第二个 SKU（续行）
      8: line("ROW-8"),
    });
    const rows = await batch.readOrderSheet("t.xlsx", buf);
    const { orders, error } = batch.parseOrders(rows, sender);
    expect(error).toBeUndefined();
    expect(orders.map((o) => [o.customerRef, o.rowNo])).toEqual([["ROW-2", 2], ["ROW-5", 5], ["ROW-8", 8]]);
    expect(orders[1].errors).toContain("收件人邮编必填");
    expect(orders[1].req.skuList).toHaveLength(2);
    // 表头前面有标题行和空行
    const titled = await xlsx({ 1: ["2026 年 10 月订单"], 3: batch.SHIPBEST_HEADERS, 4: line("T-4"), 6: line("T-6") });
    expect(batch.parseOrders(await batch.readOrderSheet("t.xlsx", titled), sender).orders.map((o) => o.rowNo)).toEqual([4, 6]);
  });

  it("报错里的行号就是表格里的行号：csv（空行、只有逗号的行、引号里换行）", async () => {
    const esc = (v: unknown) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csvLine = (vals: unknown[]) => vals.map(esc).join(",");
    const text = [
      csvLine(batch.SHIPBEST_HEADERS), // 1
      csvLine(line("C-2", { a2: "Apt 1\nBack door" })), // 2–3（引号里有换行）
      "", // 4
      ",,,,,,", // 5：Excel 另存的空行
      csvLine(line("C-6", { zip: "" })), // 6
      "\r", // 7
      csvLine(line("C-8")), // 8
    ].join("\n");
    const rows = await batch.readOrderSheet("t.csv", Buffer.from(text, "utf8"));
    const { orders } = batch.parseOrders(rows, sender);
    expect(orders.map((o) => [o.customerRef, o.rowNo])).toEqual([["C-2", 2], ["C-6", 6], ["C-8", 8]]);
    expect(orders[0].req.recipient.address2).toBe("Apt 1\nBack door");
    // 不支持的格式照旧报错
    await expect(batch.readOrderSheet("t.xls", Buffer.from("x"))).rejects.toThrow(/xls/);
  });

  it("美国邮编：Excel 存成数字丢了前导 0 的 ZIP+4 / 4 位邮编补全", async () => {
    expect(batch.normalizeUsZip("2134")).toBe("02134");
    expect(batch.normalizeUsZip("21101234")).toBe("02110-1234");
    expect(batch.normalizeUsZip("9011234")).toBe("00901-1234");
    expect(batch.normalizeUsZip("021101234")).toBe("02110-1234");
    expect(batch.normalizeUsZip("2110-1234")).toBe("02110-1234");
    expect(batch.normalizeUsZip("78701-1234")).toBe("78701-1234");
    expect(batch.normalizeUsZip("78701")).toBe("78701");
    expect(batch.normalizeUsZip("K2P 2L8")).toBe("K2P 2L8");
    const buf = await xlsx({
      1: batch.SHIPBEST_HEADERS,
      2: line("Z-1", { st: "MA", city: "Boston", zip: 21101234 }),
      3: line("Z-2", { st: "MA", city: "Boston", zip: 2134 }),
      4: line("Z-3", { st: "MA", city: "Boston", zip: "021101234" }),
    });
    const { orders } = batch.parseOrders(await batch.readOrderSheet("z.xlsx", buf), sender);
    expect(orders.map((o) => o.req.recipient.zipCode)).toEqual(["02110-1234", "02134", "02110-1234"]);
    expect(orders.every((o) => o.errors.length === 0)).toBe(true);
  });

  it("国际件：导入时直接说明要去“国际下单”，不试算、不出单", async () => {
    const buf = await xlsx({
      1: batch.SHIPBEST_HEADERS,
      2: line("I-1", { country: "CA", st: "ON", city: "Toronto", zip: "M5H 2N2", a1: "100 King St W" }),
      3: line("I-2"),
    });
    const { orders } = batch.parseOrders(await batch.readOrderSheet("i.xlsx", buf), sender);
    expect(orders[0].errors).toEqual([batch.INTL_IMPORT_MSG]);
    expect(orders[1].errors).toEqual([]);
    const jobId = batch.createJob({ customerId: cid, createdBy: "customer", filename: "i.xlsx", channels: [], pickMode: "cheapest", orders });
    batch.ensureRunning(jobId);
    const job = await wait(jobId, ["ready"]);
    const intl = job.rows.find((r) => r.customerRef === "I-1")!;
    expect(intl).toMatchObject({ status: "error", error: batch.INTL_IMPORT_MSG, selected: false, quotes: [] });
    // 修改订单改成国外地址也不行
    const us = job.rows.find((r) => r.customerRef === "I-2")!;
    expect(batch.updateRow(jobId, us.id, { recipient: { ...us.edit.recipient, country: "GB", province: undefined, city: "London", zipCode: "NW1 6XE" }, pkg: us.edit.pkg })).toBe(batch.INTL_IMPORT_MSG);
    const { translateMessage } = await import("@/lib/i18n");
    expect(translateMessage("en", batch.INTL_IMPORT_MSG)).toMatch(/International/);
  });

  it("表格里的物流产品只在客户自己的渠道里认；用不了时写明原因、取消勾选，不悄悄换物流商", async () => {
    const { clearChannelNameCache } = await import("@/lib/channelDisplay");
    // 两个渠道客户看到的名称一样（像 ShipBest 和嘉谷的 USPS）：客户只开通了其中一个
    db.setChannelDisplay("LP10210433", "USPS", "usps");
    db.setChannelDisplay("LP10210030", "USPS", "usps");
    clearChannelNameCache();
    const other = db.saveCustomer(null, { name: "只开通 SwiftX", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(other, ["LP10210028", "LP10210433"]);
    expect(batch.matchChannel("USPS", db.customerChannels(other))).toBe("LP10210433");
    expect(batch.matchChannels("USPS", db.customerChannels(cid))).toEqual(["LP10210030"]);
    expect(batch.matchChannel("USPS-（91710）", db.customerChannels(other))).toBeNull();

    const orders = batch.parseOrders(
      await batch.readOrderSheet("f.xlsx", await xlsx({
        1: batch.SHIPBEST_HEADERS,
        2: line("F-OK", { channel: "USPS" }), // → 客户自己的 LP10210433
        3: line("F-NOTMINE", { channel: "USPS-（91710）" }), // 客户没开通
        4: line("F-NOQUOTE", { channel: "USPS", st: "DC", city: "Washington", zip: "20001" }), // 这个渠道送不到 2 开头的邮编
      })),
      sender,
    ).orders;
    const jobId = batch.createJob({ customerId: other, createdBy: "customer", filename: "f.xlsx", channels: [], pickMode: "file", orders });
    batch.ensureRunning(jobId);
    const job = await wait(jobId, ["ready"]);
    const row = (ref: string) => job.rows.find((r) => r.customerRef === ref)!;
    expect(row("F-OK")).toMatchObject({ channelCode: "LP10210433", selected: true, error: null, fileChannelNote: false });
    expect(row("F-NOTMINE")).toMatchObject({ status: "quoted", selected: false, fileChannelNote: true });
    expect(row("F-NOTMINE").error).toMatch(/不在这个账户开通的渠道里/);
    expect(row("F-NOTMINE").channelCode).toBe(row("F-NOTMINE").quotes.filter((q) => q.ok).sort((a, b) => a.price! - b.price!)[0].code);
    expect(row("F-NOQUOTE")).toMatchObject({ status: "quoted", selected: false, channelCode: "LP10210028" });
    expect(row("F-NOQUOTE").error).toMatch(/这单没有报价/);
    // “按表格物流产品”批量改：用不了的保持原选择（算在没改的里）
    expect(batch.chooseAll(jobId, "file")).toEqual({ changed: 1, skipped: 2 });
    const { translateMessage } = await import("@/lib/i18n");
    expect(translateMessage("en", row("F-NOTMINE").error)).toMatch(/isn't enabled on this account/);
    db.setChannelDisplay("LP10210433", null, null);
    db.setChannelDisplay("LP10210030", null, null);
    clearChannelNameCache();
  });

  it("运费变化后：报价列表也换成新价格，“全部选最便宜”不会再用回旧价", async () => {
    const orders = [{ rowNo: 2, customerRef: "PRICE-1", fileChannel: "", req: req("78701", "PRICE-1"), errors: [] }];
    const jobId = batch.createJob({ customerId: cid, createdBy: "customer", filename: "p.xlsx", channels: ["LP10210028", "LP10210029"], pickMode: "cheapest", orders });
    batch.ensureRunning(jobId);
    let job = await wait(jobId, ["ready"]);
    const r0 = job.rows[0];
    const real = r0.price!;
    // 模拟试算之后价格变了：存着的报价比现在的便宜 0.37
    const stale = Math.round((real - 0.37) * 100) / 100;
    const quotes = r0.quotes.map((q) => (q.code === r0.channelCode ? { ...q, price: stale } : q));
    db.db().prepare("UPDATE batch_job_rows SET price = ?, quotes_json = ? WHERE id = ?").run(stale, JSON.stringify(quotes), r0.id);
    batch.confirmJob(jobId);
    job = await wait(jobId, ["ready"]);
    expect(job.error).toMatch(/运费有变化/);
    const r1 = job.rows[0];
    expect(r1.status).toBe("quoted");
    expect(r1.price).toBe(real);
    expect(r1.quotes.find((q) => q.code === r0.channelCode)!.price).toBe(real);
    // 全部选最便宜 / 重新点这个渠道：用的是新价格，再提交就成功
    batch.chooseAll(jobId, "cheapest");
    batch.chooseRowChannel(jobId, r1.id, r0.channelCode!);
    expect(batch.getJob(jobId)!.rows[0].price).toBe(real);
    batch.confirmJob(jobId);
    job = await wait(jobId, ["done"]);
    expect(job.rows[0].status).toBe("created");
  }, 30_000);

  it("提交过程中被取消勾选的单（例如店铺同步发现已取消）：跳过不下单", async () => {
    const orders = ["SKIP-1", "SKIP-2"].map((ref, i) => ({ rowNo: i + 2, customerRef: ref, fileChannel: "", req: req("78701", ref), errors: [] }));
    const jobId = batch.createJob({ customerId: cid, createdBy: "customer", filename: "s.xlsx", channels: ["LP10210029"], pickMode: "cheapest", orders });
    batch.ensureRunning(jobId);
    await wait(jobId, ["ready"]);
    batch.confirmJob(jobId);
    // 第一单已经在提交了，第二单还没轮到：这时候被取消勾选
    db.db().prepare("UPDATE batch_job_rows SET selected = 0 WHERE job_id = ? AND customer_ref = 'SKIP-2'").run(jobId);
    const job = await wait(jobId, ["ready", "done"]);
    expect(job.rows.find((r) => r.customerRef === "SKIP-1")!.status).toBe("created");
    expect(job.rows.find((r) => r.customerRef === "SKIP-2")).toMatchObject({ status: "quoted", shipmentId: null });
  }, 30_000);

  it("提交时同号的单已经建好：只关联收件邮编、渠道都对得上的那张，不会把别的订单的面单当成这一单", async () => {
    const orders = [
      { rowNo: 2, customerRef: "ADOPT-NO", fileChannel: "", req: req("78701", "ADOPT-NO"), errors: [] },
      { rowNo: 3, customerRef: "ADOPT-YES", fileChannel: "", req: req("78701", "ADOPT-YES"), errors: [] },
    ];
    const jobId = batch.createJob({ customerId: cid, createdBy: "customer", filename: "a.xlsx", channels: ["LP10210029"], pickMode: "cheapest", orders });
    batch.ensureRunning(jobId);
    const job = await wait(jobId, ["ready"]);
    const price = job.rows[0].price!;
    // 批次开始后，同一个订单号在别处已经下了单：一张寄到别的邮编，一张和这一行一模一样（服务器重启前其实已经建好）
    const q = (await svc.quoteAll(cid, req("73301")))!.find((x) => x.channelCode === "LP10210029")!;
    const elsewhere = await svc.createLabel({ customerId: cid, channelCode: "LP10210029", req: req("73301", "ADOPT-NO"), expectedPrice: q.price!, customerRef: "ADOPT-NO", waitForLabel: false });
    const same = await svc.createLabel({ customerId: cid, channelCode: "LP10210029", req: req("78701", "ADOPT-YES"), expectedPrice: price, customerRef: "ADOPT-YES", waitForLabel: false });
    batch.confirmJob(jobId);
    const done = await wait(jobId, ["ready", "done"]);
    const no = done.rows.find((r) => r.customerRef === "ADOPT-NO")!;
    const yes = done.rows.find((r) => r.customerRef === "ADOPT-YES")!;
    expect(no).toMatchObject({ status: "quoted", selected: false, shipmentId: null });
    expect(no.error).toMatch(/上次下单失败：订单号 ADOPT-NO 已经下过单/);
    expect(yes).toMatchObject({ status: "created", shipmentId: same });
    expect(elsewhere).not.toBe(same);
  }, 30_000);
});
