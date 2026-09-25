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
});
