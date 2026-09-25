import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atr-fixc-"));
process.env.DATA_DIR = dir;
process.env.SHIPBEST_MOCK = "1";

const base: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", country: "US", city: "Ontario", address1: "1 Main St", zipCode: "91761", province: "CA" },
  recipient: { nameFirst: "John", nameLast: "Doe", country: "US", city: "Austin", address1: "2 Elm St", zipCode: "73301", province: "TX" },
  pkg: { length: 10, width: 8, height: 4, weight: 2, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [],
};
const sku = { sku: "A1", productNameCn: "", productNameEn: "T-shirt", quantity: 1, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 1, width: 1, height: 1, weight: 1, unit: 3 as const };

describe("运费试算不需要商品明细", () => {
  let svc: typeof import("@/lib/service");
  let db: typeof import("@/lib/db");
  beforeAll(async () => {
    db = await import("@/lib/db");
    svc = await import("@/lib/service");
    await svc.syncChannels();
  });

  it("forQuote 跳过商品校验；出单校验不放宽", () => {
    expect(svc.validateRequest(base, { forQuote: true })).toEqual([]);
    expect(svc.validateRequest(base)).toContain("至少需要一个商品明细");
    // 地址 / 包裹仍然要校验
    const bad = { ...base, pkg: { ...base.pkg, weight: 0 } };
    expect(svc.validateRequest(bad, { forQuote: true })).toContain("包裹重量必须大于 0");
  });

  it("没有商品时补一个样品；空行去掉，填了一半的行补全", () => {
    const q = svc.withQuoteSkus(base);
    expect(q.skuList).toHaveLength(1);
    expect(q.skuList[0]).toMatchObject({ sku: "SAMPLE", productNameCn: "样品", productNameEn: "Sample", quantity: 1, declaredUnitPrice: 1, productNature: "2,4", weight: 2, unit: 3 });
    expect(svc.validateRequest(q)).toEqual([]);

    const empty = { ...sku, sku: "", productNameEn: "", declaredUnitPrice: 0 };
    expect(svc.withQuoteSkus({ ...base, skuList: [empty] }).skuList[0].sku).toBe("SAMPLE");
    const half = svc.withQuoteSkus({ ...base, skuList: [{ ...sku, declaredUnitPrice: 0 }, empty] });
    expect(half.skuList).toHaveLength(1);
    expect(half.skuList[0]).toMatchObject({ sku: "A1", productNameEn: "T-shirt", productNameCn: "T-shirt", declaredUnitPrice: 1 });
  });

  it("新客户试算：不填商品也能出报价", async () => {
    const quotes = await svc.quoteForProspect(svc.withQuoteSkus(base), {});
    expect(quotes.some((q) => q.ok)).toBe(true);
    expect(db.listChannels(true).length).toBeGreaterThan(0);
  });
});

describe("中文品名可以不填", () => {
  it("清洗时用英文品名补上中文品名；英文品名仍然必填", async () => {
    const { cleanRequest } = await import("@/lib/sanitize");
    const svc = await import("@/lib/service");
    const req = cleanRequest({ ...base, skuList: [sku] });
    expect(req.skuList[0].productNameCn).toBe("T-shirt");
    expect(svc.validateRequest(req)).toEqual([]);
    // 没清洗过的请求也不因为缺中文品名报错
    expect(svc.validateRequest({ ...base, skuList: [sku] })).toEqual([]);
    const noEn = svc.validateRequest({ ...base, skuList: [{ ...sku, productNameCn: "T恤", productNameEn: "" }] });
    expect(noEn).toContain("商品 1：英文品名必填");
    expect(noEn.some((e) => e.includes("中文品名"))).toBe(false);
  });
});

describe("批量导单模板", () => {
  it("“填写示例”表头在第 1 行，示例从第 2 行开始；物流产品、中文品名不标必填", async () => {
    const batch = await import("@/lib/batch");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await batch.buildTemplate(base.sender, { channels: ["GOFO-（91710）"] })) as unknown as ArrayBuffer);
    const ex = wb.getWorksheet("填写示例")!;
    expect(ex.getRow(1).getCell(1).value).toBe("*自定义单号");
    expect(ex.getRow(2).getCell(1).value).toBe("A1001");
    expect(ex.getRow(2).getCell(13).value).toBe("T恤");
    const tpl = wb.getWorksheet("导入模板")!;
    expect(tpl.getRow(1).getCell(1).value).toBe("*自定义单号");
    expect(tpl.getRow(2).getCell(1).value).toBe(batch.EXAMPLE_REF);
    // 下拉框仍然加在数据行上
    expect(ex.getCell("C2").dataValidation?.type).toBe("list");
    expect(tpl.getCell("C500").dataValidation?.type).toBe("list");
    // 物流产品可以留空：不是红色、不带 *
    const chHead = tpl.getRow(1).getCell(2);
    expect(chHead.value).toBe("物流产品");
    expect(chHead.font?.color?.argb).not.toBe("FFC00000");
    expect(tpl.getRow(1).getCell(13).value).toBe("品名(中文)");
  });

  it("中文品名留空时用英文品名", async () => {
    const batch = await import("@/lib/batch");
    const { readSheetRows } = await import("@/lib/adjustments");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("导入模板");
    ws.addRow(batch.SHIPBEST_HEADERS);
    const rec = ["Doe", "Jane", "512-555-0100", "US", "TX", "Austin", null, "78701", null, "1 Test St"];
    ws.addRow(["R1", null, "不需要", null, "不需要", 10, 8, 4, 2, "in/lb", null, "S1", null, "Cap", 1, 5, 2, "in/lb", null, null, null, null, null, ...rec]);
    const rows = await readSheetRows("x.xlsx", Buffer.from(await wb.xlsx.writeBuffer()), "first");
    const p = batch.parseOrders(rows, base.sender);
    expect(p.orders[0].req.skuList[0]).toMatchObject({ productNameCn: "Cap", productNameEn: "Cap" });
    expect(p.orders[0].errors).toEqual([]);
  });
});

describe("模拟面单", () => {
  it("全角括号 / 标点转成半角，不再印成 ?", async () => {
    const { pdfText } = await import("@/lib/labels");
    expect(pdfText("GOFO-（91710）")).toBe("GOFO-(91710)");
    expect(pdfText("A，B：C")).toBe("A,B:C");
    expect(pdfText("面条")).toBe("??");
  });

  it("FROM 用寄件人地址，没有时写 SENDER", async () => {
    const { mockLabelPdf } = await import("@/lib/labels");
    const withFrom = mockLabelPdf("X", { channel: "GOFO-（91710）", from: ["ACME CO", "1 MAIN ST", "ONTARIO CA 91761"] }).toString("latin1");
    expect(withFrom).toContain("FROM: ACME CO");
    expect(withFrom).toContain("GOFO-\\(91710\\)");
    expect(withFrom).not.toContain("ATR WAREHOUSE");
    expect(mockLabelPdf("X").toString("latin1")).toContain("FROM: SENDER");
    const usps = mockLabelPdf("X", { channel: "USPS Ground", from: ["ACME CO", "1 MAIN ST", "ONTARIO CA 91761"] }).toString("latin1");
    expect(usps).toContain("Mailed from 91761");
    expect(usps).not.toContain("DANIELS");
  });
});
