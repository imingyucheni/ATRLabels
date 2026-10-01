import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-ux-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

const req = (l: number, sku = "TS-01"): ShipmentRequest => ({
  sender: { nameFirst: "Ware", nameLast: "House", country: "US", city: "Los Angeles", address1: "1 Main St", zipCode: "90058", province: "CA", phone: "9095550100" },
  recipient: { nameFirst: "Jason", nameLast: "Menard", country: "US", city: "Omaha", address1: "2 Elm St", zipCode: "68104", province: "NE" },
  pkg: { length: l, width: 8, height: 4, weight: 1, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku, productNameCn: "T恤", productNameEn: "T-shirt", quantity: 1, declaredUnitPrice: 9.9, declaredCurrency: "USD", hsCode: "6109100010", productNature: "2,4", length: l, width: 8, height: 4, weight: 1, unit: 3 }],
});

describe("客户下单体验：追踪链接、再来一单、常用尺寸、商品库", () => {
  let portal: typeof import("@/lib/portal");
  let cid: number;
  let firstId: number;

  beforeAll(async () => {
    const db = await import("@/lib/db");
    const svc = await import("@/lib/service");
    const ledger = await import("@/lib/ledger");
    portal = await import("@/lib/portal");
    await svc.syncChannels();
    cid = db.saveCustomer(null, { name: "体验客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(cid, db.listChannels().map((c) => c.code));
    ledger.addLedger({ customerId: cid, type: "topup", amount: 200, createdBy: "admin" });
    for (const [l, sku] of [[10, "TS-01"], [10, "TS-01"], [12, "MUG-2"]] as const) {
      const q = (await svc.quoteAll(cid, req(l, sku))).find((x) => x.ok)!;
      const id = await svc.createLabel({ customerId: cid, channelCode: q.channelCode, req: req(l, sku), expectedPrice: q.price!, waitForLabel: false });
      firstId ??= id;
    }
  });

  it("常用尺寸按次数排", () => {
    const r = portal.recentPackages(cid);
    expect(r[0]).toMatchObject({ length: 10, width: 8, height: 4, weight: 1, unit: 3, count: 2 });
    expect(r[1]).toMatchObject({ length: 12, count: 1 });
  });

  it("商品库按 SKU 去重，带出品名 / 申报价 / 海关编码", () => {
    const p = portal.skuPresets(cid);
    expect(p.map((x) => x.sku).sort()).toEqual(["MUG-2", "TS-01"]);
    expect(p.find((x) => x.sku === "TS-01")).toMatchObject({ productNameEn: "T-shirt", declaredUnitPrice: 9.9, hsCode: "6109100010" });
  });

  it("再来一单只能复制自己的订单", () => {
    expect(portal.copySource(cid, String(firstId))?.request.recipient.city).toBe("Omaha");
    expect(portal.copySource(cid + 999, String(firstId))).toBeNull();
    expect(portal.copySource(cid, "abc")).toBeNull();
  });

  it("追踪链接：常见物流商走官网，其他走 17TRACK，奇怪的单号不出链接", async () => {
    const { trackingUrl } = await import("@/lib/carriers");
    expect(trackingUrl("usps", "9400100000000000000000")).toContain("tools.usps.com");
    expect(trackingUrl("fedex", "878013790864")).toContain("fedex.com");
    expect(trackingUrl("gofo", "GF123456789")).toContain("17track");
    expect(trackingUrl("usps", "<script>")).toBeNull();
    expect(trackingUrl("usps", null)).toBeNull();
  });
});
