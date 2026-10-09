import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-products-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

const base = {
  sku: "TS-BLU-M", productNameCn: "蓝色T恤", productNameEn: "Cotton T-shirt", declaredUnitPrice: 8, hsCode: "61091000", productNature: "2,4",
  material: "Cotton", originCountry: "CN", quantity: 1, length: 10, width: 8, height: 2, weight: 9, dimUnit: "in" as const, weightUnit: "oz" as const,
};
const order = (sku: string, quantity: number, pkg: Partial<ShipmentRequest["pkg"]> = {}): ShipmentRequest => ({
  sender: { nameFirst: "Ware", nameLast: "House", country: "US", city: "Chino", address1: "1 Main St", zipCode: "91710", province: "CA", phone: "9095550100" },
  recipient: { nameFirst: "Jane", nameLast: "Roe", country: "US", city: "Austin", address1: "500 Congress Ave", zipCode: "78701", province: "TX", phone: "5125550100" },
  pkg: { length: 0, width: 0, height: 0, weight: 0, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD", ...pkg },
  skuList: [{ sku, productNameCn: "", productNameEn: "", quantity, declaredUnitPrice: 0, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 0, width: 0, height: 0, weight: 0, unit: 3 }],
});

describe("常用产品（商品 + 包裹尺寸重量）", () => {
  let db: typeof import("@/lib/db");
  let pr: typeof import("@/lib/products");
  let cid: number;
  let other: number;

  beforeAll(async () => {
    db = await import("@/lib/db");
    pr = await import("@/lib/products");
    cid = db.saveCustomer(null, { name: "产品客户", contact: null, phone: null, email: null, note: null, markup: {} });
    other = db.saveCustomer(null, { name: "别的客户", contact: null, phone: null, email: null, note: null, markup: {} });
  });

  it("保存要有 SKU 或品名、包裹的长宽高和重量；没填名称用 “SKU · 品名”", () => {
    expect(() => pr.saveProduct(cid, { ...base, sku: "", productNameEn: "", productNameCn: "" })).toThrow(/SKU 或品名/);
    expect(() => pr.saveProduct(cid, { ...base, weight: 0 })).toThrow(/长、宽、高和重量/);
    const id = pr.saveProduct(cid, base);
    const p = pr.listProducts(cid).find((x) => x.id === id)!;
    expect(p).toMatchObject({ name: "TS-BLU-M · Cotton T-shirt", sku: "TS-BLU-M", quantity: 1, length: 10, weight: 9, dimUnit: "in", weightUnit: "oz", declaredUnitPrice: 8 });
    // 名称、单位乱填：名称照存，单位回到默认
    const id2 = pr.saveProduct(cid, { ...base, sku: "MUG-1", name: "  马克杯  两只装 ", quantity: 2.7, dimUnit: "ft" as never, weightUnit: "ton" as never });
    expect(pr.listProducts(cid).find((x) => x.id === id2)).toMatchObject({ name: "马克杯 两只装", quantity: 2, dimUnit: "in", weightUnit: "lb" });
  });

  it("同一个 SKU 只存一个：再存一次 = 更新；改成别的产品已经用的 SKU 不行；只能改 / 删自己的", () => {
    const before = pr.listProducts(cid).length;
    pr.saveProduct(cid, { ...base, name: "蓝色T恤 M码" });
    // 下单页“存为常用产品”（不带名称）再存一次：更新尺寸重量，名称不变
    const { name: _n, ...noName } = { ...base, sku: "ts-blu-m", weight: 10, name: undefined };
    void _n;
    const id = pr.saveProduct(cid, noName);
    expect(pr.listProducts(cid).length).toBe(before);
    expect(pr.listProducts(cid).find((x) => x.id === id)).toMatchObject({ weight: 10, name: "蓝色T恤 M码" });
    // 编辑页把名称清空：回到默认的 “SKU · 品名”
    pr.saveProduct(cid, { ...noName, id, name: "" });
    expect(pr.listProducts(cid).find((x) => x.id === id)?.name).toBe("ts-blu-m · Cotton T-shirt");
    const mug = pr.listProducts(cid).find((x) => x.sku === "MUG-1")!;
    expect(() => pr.saveProduct(cid, { ...base, id: mug.id, sku: "TS-BLU-M" })).toThrow(/另一个常用产品/);
    // 别的客户改不了、删不掉
    expect(() => pr.saveProduct(other, { ...base, id: mug.id })).toThrow(/产品不存在/);
    pr.deleteProduct(other, mug.id);
    expect(pr.listProducts(cid).some((x) => x.id === mug.id)).toBe(true);
    expect(pr.listProducts(other)).toEqual([]);
    pr.deleteProduct(cid, mug.id);
    expect(pr.listProducts(cid).some((x) => x.id === mug.id)).toBe(false);
  });

  it("包裹换算成服务商认的单位：英寸配磅（盎司换成磅）；厘米配克 / 公斤", () => {
    // 上一步用小写 SKU 更新过（10 oz）
    const p = pr.listProducts(cid).find((x) => x.sku.toUpperCase() === "TS-BLU-M")!;
    expect(p.weight).toBe(10);
    expect(pr.productPackage(p)).toMatchObject({ length: 10, width: 8, height: 2, weight: 0.625, unit: 3 });
    expect(pr.productPackage({ ...p, dimUnit: "cm", weightUnit: "g", weight: 500 })).toMatchObject({ weight: 500, unit: 1 });
    expect(pr.productPackage({ ...p, dimUnit: "cm", weightUnit: "lb", weight: 2 })).toMatchObject({ weight: 0.9072, unit: 2 });
    const combos = pr.packagesFromProducts(cid);
    expect(combos.get("TS-BLU-M×1")).toMatchObject({ weight: 0.625, unit: 3 });
  });

  it("批量导入只填 SKU：带出品名、申报价、海关编码；件数一样、包裹没填时带出尺寸重量", () => {
    const list = pr.listProducts(cid);
    const a = order("ts-blu-m", 1);
    expect(pr.fillFromProduct(a, list)).toBe(true);
    expect(a.skuList[0]).toMatchObject({ productNameEn: "Cotton T-shirt", productNameCn: "蓝色T恤", declaredUnitPrice: 8, hsCode: "61091000", material: "Cotton", originCountry: "CN" });
    expect(a.pkg).toMatchObject({ length: 10, width: 8, height: 2, weight: 0.625, displayUnitSystem: 3 });
    // 表格里填了包裹：不改
    const b = order("TS-BLU-M", 1, { length: 12, width: 9, height: 3, weight: 1 });
    pr.fillFromProduct(b, list);
    expect(b.pkg).toMatchObject({ length: 12, weight: 1 });
    // 件数不一样：只带出商品信息，包裹不知道多大，不带
    const c = order("TS-BLU-M", 3);
    pr.fillFromProduct(c, list);
    expect(c.skuList[0].productNameEn).toBe("Cotton T-shirt");
    expect(c.pkg.length).toBe(0);
    // 不认识的 SKU、多个商品：不动
    expect(pr.fillFromProduct(order("NOPE", 1), list)).toBe(false);
    const d = order("TS-BLU-M", 1);
    d.skuList.push({ ...d.skuList[0], sku: "X" });
    expect(pr.fillFromProduct(d, list)).toBe(false);
  });

  it("从最近的订单添加：一单一个 SKU、有包裹的订单；已经存过的 SKU 不再出现", async () => {
    const svc = await import("@/lib/service");
    const { addLedger } = await import("@/lib/ledger");
    await svc.syncChannels();
    const code = db.listChannels().filter((c) => !/HWT|MWT/.test(c.name) && !c.code.startsWith("DHL"))[0].code;
    db.setCustomerChannels(cid, [code]);
    addLedger({ customerId: cid, type: "topup", amount: 100, createdBy: "admin" });
    const req = order("CAP-RED", 1, { length: 9, width: 9, height: 5, weight: 0.5 });
    req.skuList[0] = { ...req.skuList[0], productNameEn: "Red cap", declaredUnitPrice: 6, length: 9, width: 9, height: 5, weight: 0.5 };
    const q = await svc.quoteChannel(cid, code, req);
    await svc.createLabel({ customerId: cid, channelCode: code, req, expectedPrice: q.price!, waitForLabel: false });
    const s = pr.productSuggestions(cid);
    expect(s.find((x) => x.sku === "CAP-RED")).toMatchObject({ productNameEn: "Red cap", length: 9, weight: 0.5, dimUnit: "in", weightUnit: "lb", quantity: 1 });
    pr.saveProduct(cid, s.find((x) => x.sku === "CAP-RED")!);
    expect(pr.productSuggestions(cid).some((x) => x.sku === "CAP-RED")).toBe(false);
  });
});
