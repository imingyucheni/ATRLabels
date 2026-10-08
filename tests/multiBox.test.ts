import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";
import { checkMultiBox, multiBoxRule, summarizePieces, MULTI_BOX_RULES } from "@/lib/multiBox";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atr-multi-"));
process.env.DATA_DIR = dir;
process.env.SHIPBEST_MOCK = "1";

const hwt = MULTI_BOX_RULES.find((r) => r.id === "ups-hwt")!;
const mwt = MULTI_BOX_RULES.find((r) => r.id === "fedex-mwt")!;
const sender = { nameFirst: "Ware", nameLast: "House", phone: "9095550100", country: "US", city: "Ontario", address1: "1 Main St", zipCode: "91761", province: "CA" };
const recipient = { nameFirst: "Store", nameLast: "Manager", phone: "5125550100", country: "US", city: "Austin", address1: "2 Elm St", zipCode: "73301", province: "TX" };
const req = (pieces: ShipmentRequest["pkg"]["pieces"], item: { name?: string; hs?: string } = {}): ShipmentRequest => ({
  sender, recipient,
  pkg: { length: 0, width: 0, height: 0, weight: 0, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD", pieces },
  skuList: [{ sku: "CARTON", productNameCn: "", productNameEn: item.name ?? "Cotton T-shirts", quantity: 1, declaredUnitPrice: 500, declaredCurrency: "USD", hsCode: item.hs ?? "61091000", productNature: "2,4", length: 0, width: 0, height: 0, weight: 0, unit: 3 }],
});

describe("多箱寄出：渠道规则", () => {
  it("按渠道名认出 UPS HWT / FedEx MWT", () => {
    expect(multiBoxRule("UPS-NEW-HWT-XT · GDE")?.id).toBe("ups-hwt");
    expect(multiBoxRule("FedEx-MWT · GDE")?.id).toBe("fedex-mwt");
    expect(multiBoxRule("Fedex NG末端-N · GDE")).toBeNull();
  });

  it("计费重：每箱取实重和体积重（÷250）较大的；平均不足 25 lb 按 25 lb", () => {
    const s = summarizePieces([{ length: 20, width: 20, height: 20, weight: 30, qty: 4 }, { length: 10, width: 10, height: 10, weight: 10, qty: 6 }], hwt);
    expect(s).toMatchObject({ boxes: 10, actual: 180 });
    // 4 × max(30, 32) + 6 × max(10, 4) = 128 + 60 = 188 < 25 × 10 = 250
    expect(s.billable).toBe(250);
  });

  it("UPS HWT：总重 200–2000 lb、至少 2 箱、单箱 ≤ 50 lb、不能有 AHS / Oversize、英文品名、HS ≥ 8 位", () => {
    const ok = [{ length: 18, width: 14, height: 12, weight: 40, qty: 6 }];
    expect(checkMultiBox(hwt, ok, [{ productNameEn: "Cotton T-shirts", hsCode: "61091000" }], { forOrder: true })).toEqual([]);
    expect(checkMultiBox(hwt, [{ length: 18, width: 14, height: 12, weight: 40, qty: 5 }])).toEqual([]); // 200 lb 可以
    expect(checkMultiBox(hwt, [{ length: 18, width: 14, height: 12, weight: 39, qty: 5 }]).join()).toMatch(/至少 200 lb/);
    expect(checkMultiBox(hwt, [{ length: 18, width: 14, height: 12, weight: 45, qty: 45 }]).join()).toMatch(/最多 2000 lb/);
    expect(checkMultiBox(hwt, [{ length: 18, width: 14, height: 12, weight: 210, qty: 1 }]).join()).toMatch(/至少 2 箱/);
    expect(checkMultiBox(hwt, [{ length: 18, width: 14, height: 12, weight: 55, qty: 5 }]).join()).toMatch(/单箱不能超过 50 lb/);
    expect(checkMultiBox(hwt, [{ length: 50, width: 14, height: 12, weight: 40, qty: 6 }]).join()).toMatch(/最长边 50 in 超过 48 in/);
    expect(checkMultiBox(hwt, [{ length: 40, width: 32, height: 6, weight: 40, qty: 6 }]).join()).toMatch(/次长边/);
    expect(checkMultiBox(hwt, ok, [{ productNameEn: "棉T恤", hsCode: "6109" }], { forOrder: true }).join()).toMatch(/不能有中文.*至少 8 位/);
  });
});

describe("多箱寄出：FedEx MWT 规则（按结算价格表）", () => {
  it("DIM 225；超重 / 超尺寸照样能发但提醒另收费、按最低计费重算；超出最大限制、寄 48 州以外不能发", async () => {
    const { multiBoxWarnings } = await import("@/lib/multiBox");
    // 普通箱子：没有提醒
    const ok = [{ length: 18, width: 14, height: 12, weight: 40, qty: 6 }];
    expect(checkMultiBox(mwt, ok, [], { state: "TX" })).toEqual([]);
    expect(multiBoxWarnings(mwt, ok)).toEqual([]);
    expect(summarizePieces(ok, mwt).billable).toBe(240); // 每箱 max(40, ceil(3024/225)=14)
    // 单箱 60 lb：可以发，提醒 AHS
    const heavy = [{ length: 18, width: 14, height: 12, weight: 60, qty: 4 }];
    expect(checkMultiBox(mwt, heavy)).toEqual([]);
    expect(multiBoxWarnings(mwt, heavy).join()).toMatch(/4 箱会另收额外处理费（AHS，单箱 60 lb 超过 50 lb）/);
    // 小而长的箱子（最长边 50 in）收 AHS，计费重最低按 40 lb
    const long = [{ length: 50, width: 10, height: 10, weight: 20, qty: 10 }];
    expect(summarizePieces(long, mwt).billable).toBe(400);
    // 超尺寸（实重 120 lb）：提醒，最低 90 lb
    expect(multiBoxWarnings(mwt, [{ length: 30, width: 20, height: 20, weight: 120, qty: 2 }]).join()).toMatch(/超尺寸/);
    // 超出最大限制：不能发
    expect(checkMultiBox(mwt, [{ length: 110, width: 10, height: 10, weight: 40, qty: 6 }]).join()).toMatch(/最长边 110 in 超过 108 in/);
    expect(checkMultiBox(mwt, [{ length: 48, width: 40, height: 30, weight: 100, qty: 3 }]).join()).toMatch(/计费重 256 lb 超过 150 lb/);
    // 只发本土 48 州
    expect(checkMultiBox(mwt, ok, [], { state: "HI" }).join()).toMatch(/只发美国本土 48 州/);
    expect(checkMultiBox(hwt, ok, [], { state: "HI" })).toEqual([]);
  });
});

describe("多箱寄出：报价和下单（模拟模式）", () => {
  let db: typeof import("@/lib/db");
  let svc: typeof import("@/lib/service");
  let ledger: typeof import("@/lib/ledger");
  let cid = 0;

  beforeAll(async () => {
    db = await import("@/lib/db");
    svc = await import("@/lib/service");
    ledger = await import("@/lib/ledger");
    db.saveSettings({ markup: { percent: 10, fixed: 0, minProfit: 0 } });
    await svc.syncChannels();
    cid = db.saveCustomer(null, { name: "补货客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(cid, db.listChannels().map((c) => c.code));
    ledger.addLedger({ customerId: cid, type: "topup", amount: 1000 });
  });

  it("普通下单不报多箱渠道，多箱寄出只报多箱渠道", async () => {
    const single: ShipmentRequest = { sender, recipient, pkg: { length: 10, width: 8, height: 4, weight: 2, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" }, skuList: req([]).skuList };
    const normal = await svc.quoteAll(cid, single);
    expect(normal.some((q) => /HWT/.test(q.channelName))).toBe(false);
    const all = await svc.quoteMulti(cid, req([{ length: 18, width: 14, height: 12, weight: 40, qty: 6 }]));
    expect(all.map((q) => q.channelCode).sort()).toEqual(["LP10219918", "LP10219919"]); // UPS HWT + FedEx MWT
    expect(all.every((q) => q.ok)).toBe(true);
    const multi = all.filter((q) => q.channelCode === "LP10219918");
    // 240 lb：200–500 档，按每 100 lb 计价，最低 81.60
    expect(multi[0].cost).toBeGreaterThanOrEqual(81.6);
    expect(multi[0].price).toBeCloseTo(Math.ceil(multi[0].cost! * 1.1 * 100) / 100, 1);
    // 不符合要求的直接显示原因，不去问服务商
    const light = await svc.quoteMulti(cid, req([{ length: 18, width: 14, height: 12, weight: 20, qty: 3 }]));
    expect(light[0].ok).toBe(false);
    expect(light[0].error).toMatch(/至少 200 lb/);
  });

  it("下单：一票多箱，扣一次钱，记下箱规；品名有中文 / HS 不够 8 位不能下单", async () => {
    const pieces = [{ length: 18, width: 14, height: 12, weight: 40, qty: 4 }, { length: 16, width: 12, height: 10, weight: 30, qty: 3 }];
    const q = (await svc.quoteMulti(cid, req(pieces))).find((x) => x.channelCode === "LP10219918")!;
    await expect(svc.createLabel({ customerId: cid, channelCode: q.channelCode, req: req(pieces, { name: "棉 T 恤" }), expectedPrice: q.price! })).rejects.toThrow(/不能有中文/);
    await expect(svc.createLabel({ customerId: cid, channelCode: q.channelCode, req: req(pieces, { hs: "610910" }), expectedPrice: q.price! })).rejects.toThrow(/至少 8 位/);
    const before = ledger.balanceOf(cid);
    const id = await svc.createLabel({ customerId: cid, channelCode: q.channelCode, req: req(pieces), expectedPrice: q.price!, waitForLabel: false });
    const s = db.getShipment(id)!;
    expect(s.pkg.pieces).toEqual(pieces);
    expect(s.pkg.weight).toBe(250);
    expect(s.price).toBe(q.price);
    expect(ledger.balanceOf(cid)).toBeCloseTo(before - q.price!, 2);
    // 多箱渠道不能用普通方式（没有箱规）下单
    const single: ShipmentRequest = { sender, recipient, pkg: { length: 10, width: 8, height: 4, weight: 2, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" }, skuList: req([]).skuList };
    await expect(svc.createLabel({ customerId: cid, channelCode: q.channelCode, req: single, expectedPrice: 1 })).rejects.toThrow(/多箱寄出/);
  });

  it("开放范围：默认不开放，后台逐个客户开放 / 关闭", async () => {
    const acc = await import("@/lib/multiAccess");
    expect(acc.multiEnabled(cid)).toBe(false);
    acc.setMultiEnabled(cid, true);
    expect(acc.multiEnabled(cid)).toBe(true);
    acc.setMultiEnabled(cid, false);
    expect(acc.multiEnabled(cid)).toBe(false);
  });

  it("嘉谷：多箱一箱一个 Package（英寸 / 磅），申报价值按箱平均分，带海关编码", async () => {
    const jg = await import("@/lib/shipbest/jiagu");
    const cfg = { clientId: "", secret: "", ownershipId: 1, customerId: 2, warehouseId: 0, warehouses: { "582918": 230496 }, variants: [], authUrl: "", apiUrl: "" };
    const b = jg.buildJiaguBody(cfg, req([{ length: 18, width: 14, height: 12, weight: 40, qty: 2 }, { length: 16, width: 12, height: 10, weight: 30, qty: 2 }]), 582918);
    expect(b.WarehouseID).toBe(230496);
    expect(b.Packages.length).toBe(4);
    expect(b.Packages[0]).toMatchObject({ PackageIdentifier: "P1", Length: 18, Weight: 40, LengthUnit: "IN", WeightUnit: "LB", Qty: 1, DeclareValue: 125, HSCode: "61091000", DeclareEnName: "Cotton T-shirts" });
    expect(b.Packages[3]).toMatchObject({ PackageIdentifier: "P4", Length: 16, Weight: 30 });
    const { defaultPublicName } = await import("@/lib/carriers");
    expect(defaultPublicName("UPS-NEW-HWT-XT · GDE")).toBe("UPS Ground 多箱 (HWT)");
  });
});
