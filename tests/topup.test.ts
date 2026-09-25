import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-topup-"));
process.env.SHIPBEST_MOCK = "1";

describe("充值与按订单扣款", () => {
  let db: typeof import("@/lib/db");
  let ledger: typeof import("@/lib/ledger");
  let topup: typeof import("@/lib/topup");
  let fx: typeof import("@/lib/fx");
  beforeAll(async () => {
    db = await import("@/lib/db");
    ledger = await import("@/lib/ledger");
    topup = await import("@/lib/topup");
    fx = await import("@/lib/fx");
    // 测试不依赖外网：固定汇率 7.1 + 加点 0.03
    db.saveSettings({ fxMode: "manual", fxManualRate: 7.1, fxMarkup: 0.03 });
  });

  it("人民币应付金额 = 美元 × (汇率 + 加点)，向上取到分", async () => {
    const q = await fx.usdCnyQuote();
    expect(q.rate).toBe(7.13);
    expect(fx.cnyToPay(100, q.rate)).toBe(713);
    expect(fx.cnyToPay(12.34, 7.13)).toBe(87.99); // 87.9842 → 87.99
    expect(fx.cnyToPay(10, 7.1)).toBe(71); // 不因浮点误差多一分
  });

  it("Zelle / 支付宝充值申请 → 确认到账记入钱包；拒绝不入账；不能重复处理", async () => {
    const c = db.saveCustomer(null, { name: "充值客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(c, db.listChannels().map((c) => c.code));
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");
    const z = await topup.createTopup({ customerId: c, method: "zelle", amountUsd: 200, reference: "ZL123", proof: png });
    const a = await topup.createTopup({ customerId: c, method: "alipay", amountUsd: 100 });
    const za = topup.getTopup(z)!;
    const al = topup.getTopup(a)!;
    expect(za).toMatchObject({ payCurrency: "USD", payAmount: 200, status: "pending", hasProof: true });
    expect(al).toMatchObject({ payCurrency: "CNY", payAmount: 713, fxRate: 7.13, fxLive: 7.1 });
    expect(topup.pendingTopupCount()).toBe(2);
    expect(topup.readTopupProof(z)!.mime).toBe("image/png");
    await expect(topup.createTopup({ customerId: c, method: "zelle", amountUsd: 0 })).rejects.toThrow(/1 到 100000/);
    await expect(topup.createTopup({ customerId: c, method: "zelle", amountUsd: 5, proof: Buffer.from("x") })).rejects.toThrow(/PNG/);

    topup.approveTopup(z, 200, null);
    expect(ledger.balanceOf(c)).toBe(200);
    expect(() => topup.approveTopup(z, 200, null)).toThrow(/处理过/);
    expect(() => topup.rejectTopup(a, "")).toThrow(/原因/);
    topup.rejectTopup(a, "未收到款项");
    expect(ledger.balanceOf(c)).toBe(200);
    expect(topup.getTopup(a)!.status).toBe("rejected");
    const entry = ledger.listLedger({ customerId: c })[0];
    expect(entry.type).toBe("topup");
    expect(entry.note).toContain("Zelle $200.00");
  });

  it("按订单扣款明细：运费 + 补差 - 退款 = 实际扣款", async () => {
    const svc = await import("@/lib/service");
    await svc.syncChannels();
    const req: ShipmentRequest = {
      sender: { nameFirst: "W", nameLast: "H", country: "US", city: "Chino", address1: "1 Main", zipCode: "91710", province: "CA" },
      recipient: { nameFirst: "J", nameLast: "D", country: "US", city: "Austin", address1: "2 Elm", zipCode: "73301", province: "TX" },
      pkg: { length: 10, width: 8, height: 4, weight: 2, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
      skuList: [{ sku: "A1", productNameCn: "T恤", productNameEn: "T-shirt", quantity: 1, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 10, width: 8, height: 4, weight: 2, unit: 3 }],
    };
    const c = db.saveCustomer(null, { name: "明细客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(c, db.listChannels().map((c) => c.code));
    ledger.addLedger({ customerId: c, type: "topup", amount: 100, createdBy: "admin" });
    const q = (await svc.quoteAll(c, req))[0];
    const id1 = await svc.createLabel({ customerId: c, channelCode: q.channelCode, req, expectedPrice: q.price! });
    const id2 = await svc.createLabel({ customerId: c, channelCode: q.channelCode, req, expectedPrice: q.price! });
    // 第二单取消（已出单，收 10%）
    await svc.requestCancel(id2);
    const fees = svc.defaultCancelFees(db.getShipment(id2)!);
    svc.confirmCancelled(id2, fees.cancelFee, fees.sbCancelFee);
    // 第一单补差 0.5
    ledger.addLedger({ customerId: c, type: "adjustment", amount: -0.5, shipmentId: id1, createdBy: "system" });

    const rows = ledger.listOrderCharges(c);
    const r1 = rows.find((r) => r.shipmentId === id1)!;
    const r2 = rows.find((r) => r.shipmentId === id2)!;
    expect(r1).toMatchObject({ freight: q.price, adjustment: 0.5, refund: 0 });
    expect(r1.net).toBeCloseTo(q.price! + 0.5, 2);
    expect(r2.refund).toBeCloseTo(q.price! - fees.cancelFee, 2);
    expect(r2.net).toBeCloseTo(fees.cancelFee, 2);
    // 合计与余额一致
    expect(100 - rows.reduce((a, r) => a + r.net, 0)).toBeCloseTo(ledger.balanceOf(c), 2);
    // 扣款记录带渠道说明
    expect(ledger.listLedger({ shipmentId: id1 }).find((l) => l.type === "label")!.note).toContain("运费");
  }, 30_000);
});
