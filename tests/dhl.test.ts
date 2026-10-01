import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-dhl-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

const req = (over: Partial<ShipmentRequest["recipient"]> = {}, skus?: Partial<ShipmentRequest["skuList"][number]>[]): ShipmentRequest => ({
  sender: { nameFirst: "ATR", nameLast: "Warehouse", country: "US", province: "CA", city: "Chino", address1: "13950 Central Ave", zipCode: "91710", phone: "9095550100" },
  recipient: { nameFirst: "Oliver", nameLast: "Smith", country: "GB", city: "London", address1: "221B Baker Street", zipCode: "NW1 6XE", phone: "+44 20 7946 0000", ...over },
  pkg: { length: 12, width: 10, height: 6, weight: 3.3, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: (skus ?? [{}]).map((s, i) => ({
    sku: `SKU-${i + 1}`, productNameCn: "T恤", productNameEn: "Cotton T-shirt", quantity: 2, declaredUnitPrice: 12.5, declaredCurrency: "USD",
    hsCode: "6109.10.0010", productNature: "2,4", material: "100% cotton", length: 12, width: 10, height: 6, weight: 0, unit: 3, ...s,
  })),
});

describe("DHL Express 国际快递", () => {
  let db: typeof import("@/lib/db");
  let svc: typeof import("@/lib/service");
  let dhl: typeof import("@/lib/shipbest/dhl");
  let client: typeof import("@/lib/shipbest/client");
  let ledger: typeof import("@/lib/ledger");
  let cid: number;
  const cfg = { apiKey: "k", apiSecret: "s", accountNumber: "123456789", baseUrl: "x", labelTemplate: "ECOM26_A6_002" as const, paperless: true, originCountry: "CN" };

  beforeAll(async () => {
    db = await import("@/lib/db");
    svc = await import("@/lib/service");
    dhl = await import("@/lib/shipbest/dhl");
    client = await import("@/lib/shipbest/client");
    ledger = await import("@/lib/ledger");
    db.saveSettings({ dhl: { ...dhl.DEFAULT_DHL, enabled: true }, sender: req().sender });
    await svc.syncChannels();
    cid = db.saveCustomer(null, { name: "国际客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(cid, db.listChannels().map((c) => c.code));
    ledger.addLedger({ customerId: cid, type: "topup", amount: 500, createdBy: "admin" });
  });

  it("同步渠道后有 DHL-P / Y / E，客户看到的名称不带服务商标记", async () => {
    const codes = db.listChannels().map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(["DHL-P", "DHL-Y", "DHL-E"]));
    const { defaultPublicName } = await import("@/lib/carriers");
    expect(defaultPublicName("DHL Express Worldwide · DHL")).toBe("DHL Express Worldwide");
  });

  it("出单请求：单位换成公制、报关明细、电子发票、免 AES 申报、地址截到 45 字", () => {
    const r = req({ address1: "Flat 12, Very Long Building Name, 221B Baker Street Marylebone" });
    const b = dhl.buildShipmentBody(cfg, "P", r, { customNo: "ATR123", reference: "PO-9", paperless: true });
    const pk = b.content.packages[0];
    expect(pk.weight).toBe(1.5); // 3.3 lb
    expect(pk.dimensions).toEqual({ length: 31, width: 26, height: 16 }); // 12×10×6 in 向上取整
    expect(b.customerDetails.receiverDetails.postalAddress.addressLine1.length).toBeLessThanOrEqual(45);
    expect(b.customerDetails.receiverDetails.contactInformation.companyName).toBe("Oliver Smith");
    expect(b.valueAddedServices).toEqual([{ serviceCode: "WY" }]);
    expect(b.content.declaredValue).toBe(25);
    expect(b.content.USFilingTypeValue).toBe("30.37(a)");
    const li = b.content.exportDeclaration.lineItems[0];
    expect(li).toMatchObject({ number: 1, description: "Cotton T-shirt (100% cotton)", price: 12.5, quantity: { value: 2, unitOfMeasurement: "PCS" }, manufacturerCountry: "CN", commodityCodes: [{ typeCode: "outbound", value: "6109100010" }] });
    expect(li.weight.netValue).toBeLessThanOrEqual(pk.weight);
    expect(b.content.exportDeclaration.invoice).toMatchObject({ number: "ATR123", function: "both" });
    expect(b.customerReferences[0].value).toBe("PO-9");
    expect(b.outputImageProperties.imageOptions[0]).toEqual({ typeCode: "label", templateName: "ECOM26_A6_002" });
    expect(dhl.plannedShipTime()).toMatch(/^\d{4}-\d{2}-\d{2}T(16|10):00:00GMT-0[78]:00$/);
  });

  it("国际件校验：收件电话、HS 编码、原产国、超过 $2,500 要 AES；无邮编国家可以不填邮编", () => {
    const e1 = svc.validateRequest(req({ phone: "" }, [{ hsCode: "" }]));
    expect(e1.join("|")).toMatch(/电话必填/);
    expect(e1.join("|")).toMatch(/HS Code/);
    expect(svc.validateRequest(req({}, [{ hsCode: "12" }])).join("|")).toMatch(/6–10 位/);
    expect(svc.validateRequest(req({}, [{ originCountry: "ZZ" }])).join("|")).toMatch(/原产国/);
    expect(svc.validateRequest(req({}, [{ material: "" }])).join("|")).toMatch(/材质必填/);
    expect(svc.validateRequest(req({}, [{ declaredUnitPrice: 1300 }])).join("|")).toMatch(/AES/);
    expect(svc.validateRequest(req({ country: "HK", city: "Hong Kong", zipCode: "" }))).toEqual([]);
    expect(svc.validateRequest(req())).toEqual([]);
  });

  it("按收件国家挑渠道：寄英国只报 DHL，寄美国不报 DHL", async () => {
    const intl = await svc.quoteAll(cid, req());
    expect(intl.length).toBeGreaterThan(0);
    expect(intl.every((q) => dhl.isDhlCode(q.channelCode))).toBe(true);
    const ok = intl.filter((q) => q.ok);
    expect(ok.length).toBe(3);
    expect(ok[0].zone).toMatch(/工作日/);
    const us = await svc.quoteAll(cid, req({ country: "US", province: "TX", city: "Austin", zipCode: "78701", address1: "500 Congress Ave" }));
    expect(us.some((q) => dhl.isDhlCode(q.channelCode))).toBe(false);
  });

  it("下单：同步拿到面单和商业发票、扣费；没揽收可以取消，全额按规则退款且没有服务商取消费", async () => {
    const q = (await svc.quoteAll(cid, req())).find((x) => x.ok && x.channelCode === "DHL-P")!;
    const before = ledger.balanceOf(cid);
    const id = await svc.createLabel({ customerId: cid, channelCode: "DHL-P", req: req(), expectedPrice: q.price!, customerRef: "INTL-1" });
    const s = db.getShipment(id)!;
    expect(s.status).toBe("labeled");
    expect(s.trackingNo).toMatch(/^\d{10}$/);
    expect(s.labelPath).toBeTruthy();
    expect(dhl.dhlInvoiceBytes(s.customNo)?.subarray(0, 4).toString()).toBe("%PDF");
    expect(dhl.dhlDocInfo(s.customNo)).toEqual({ hasInvoice: true, paperless: true });
    expect(ledger.balanceOf(cid)).toBeCloseTo(before - q.price!, 2);
    const r = await svc.requestCancel(id);
    expect(r.done).toBe(true);
    expect(db.getShipment(id)).toMatchObject({ status: "cancelled", sbCancelFee: 0 });
  });

  it("目的地不支持电子发票：自动去掉 WY 重新提交，标记要打印发票", async () => {
    const calls: unknown[] = [];
    const base = dhl.mockDhlTransport(() => Buffer.from("%PDF-1.4 mock"));
    const c = new dhl.DhlClient(cfg, async (m, p, b) => {
      calls.push(b);
      const vas = (b as { valueAddedServices?: { serviceCode: string }[] })?.valueAddedServices ?? [];
      if (p === "/shipments" && vas.some((v) => v.serviceCode === "WY")) return { status: 422, json: { title: "Validation error", detail: "Product does not support service WY (Paperless Trade) for this destination", status: "422" } };
      return base(m, p, b);
    });
    await c.createOrder("ATR-WY", "DHL-P", req({ country: "BR", city: "Sao Paulo", zipCode: "01310-100" }));
    expect(calls.length).toBe(2);
    expect(dhl.dhlDocInfo("ATR-WY")).toEqual({ hasInvoice: true, paperless: false });
  });

  it("已揽收的运单不能取消；DHL 的错误原话会带上来", async () => {
    const base = dhl.mockDhlTransport(() => Buffer.from("%PDF-1.4 mock"));
    const c = new dhl.DhlClient(cfg, async (m, p, b) => {
      if (p.includes("/tracking")) return { status: 200, json: { shipments: [{ events: [{ typeCode: "PU", description: "Shipment picked up" }] }] } };
      return base(m, p, b);
    });
    await c.createOrder("ATR-PU", "DHL-P", req());
    await expect(c.cancelOrder("ATR-PU")).rejects.toThrow(/已经揽收/);
    const bad = new dhl.DhlClient(cfg, async () => ({ status: 400, json: { title: "Bad request", detail: "#/customerDetails/receiverDetails/postalAddress: postalCode invalid", additionalDetails: ["Invalid postal code for GB"], status: "400" } }));
    await expect(bad.trialPrice("DHL-P", req())).rejects.toThrow(/postalCode invalid：Invalid postal code for GB/);
    expect(client.getDhlClient()).toBeNull(); // 没填账号时不会去连真实 DHL
  });
});
