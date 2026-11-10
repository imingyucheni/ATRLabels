import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-disputes-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", country: "US", city: "Chino", address1: "1 Main St", zipCode: "91710", province: "CA", phone: "9095550100" },
  recipient: { nameFirst: "Jane", nameLast: "Roe", country: "US", city: "Austin", address1: "500 Congress Ave", zipCode: "78701", province: "TX", phone: "5125550100" },
  pkg: { length: 10, width: 8, height: 4, weight: 2, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "MUG", productNameCn: "杯子", productNameEn: "Mug", quantity: 1, declaredUnitPrice: 12, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 10, width: 8, height: 4, weight: 2, unit: 3 }],
};

describe("运费申诉：服务商退回后退给客户", () => {
  let db: typeof import("@/lib/db");
  let svc: typeof import("@/lib/service");
  let ledger: typeof import("@/lib/ledger");
  let dp: typeof import("@/lib/disputes");
  let cid: number;
  let sid: number;

  beforeAll(async () => {
    db = await import("@/lib/db");
    svc = await import("@/lib/service");
    ledger = await import("@/lib/ledger");
    dp = await import("@/lib/disputes");
    await svc.syncChannels();
    cid = db.saveCustomer(null, { name: "申诉客户", contact: null, phone: null, email: null, note: null, markup: { percent: 10 } });
    db.setCustomerChannels(cid, db.listChannels().filter((c) => !c.code.startsWith("JG") && !c.code.startsWith("DHL") && !/HWT|MWT/.test(c.name)).map((c) => c.code));
    ledger.addLedger({ customerId: cid, type: "topup", amount: 100, createdBy: "admin" });
    const q = (await svc.quoteAll(cid, req)).find((x) => x.ok)!;
    sid = await svc.createLabel({ customerId: cid, channelCode: q.channelCode, req, expectedPrice: q.price!, waitForLabel: false });
    db.db().prepare("UPDATE shipments SET status = 'labeled', tracking_no = 'GFUSDISPUTE1' WHERE id = ?").run(sid);
  });

  it("记录申诉 → 成功：按这一单的加价比例退给客户，记成补差，客户余额加回，利润相应减少", () => {
    const s0 = db.getShipment(sid)!;
    expect(s0.rule.percent).toBe(10);
    const profit0 = db.shipmentProfit(s0)!;
    const id = dp.createDispute(sid, { reason: "超偏远费收错，地址不在偏远地区", claimAmount: 2.63, note: "工单 #123" }, "主管理员");
    expect(dp.openDisputeCount()).toBe(1);
    expect(dp.listDisputes({ status: "open" })[0]).toMatchObject({ id, shipmentId: sid, provider: "ShipBest", reason: "超偏远费收错，地址不在偏远地区", claimAmount: 2.63, customerName: "申诉客户" });
    const before = ledger.balanceOf(cid);
    // 服务商退回 2.63，加价 10% → 2.893 → 舍去零头 2.89
    expect(dp.winDispute(id, { refundCost: 2.63 }, "主管理员")).toEqual({ refundCost: 2.63, refundCustomer: 2.89 });
    expect(ledger.balanceOf(cid)).toBeCloseTo(before + 2.89, 2);
    expect(dp.openDisputeCount()).toBe(0);
    const s1 = db.getShipment(sid)!;
    expect(s1.costAdj).toBeCloseTo(-2.63, 2);
    expect(s1.customerAdj).toBeCloseTo(-2.89, 2);
    expect(db.shipmentProfit(s1)!).toBeCloseTo(profit0 - 0.26, 2);
    // 记在“运费申诉退款 YYYY-MM”这个补差批次里，客户的补差明细里能看到退款
    const adj = db.listAdjustments({ shipmentId: sid });
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ costAmount: -2.63, customerAmount: -2.89, reason: "运费申诉成功退回：超偏远费收错，地址不在偏远地区" });
    expect(db.getAdjustmentBatch(adj[0].batchId)!.filename).toMatch(/^运费申诉退款 \d{4}-\d{2}$/);
    expect(db.listAdjustments({ customerId: cid }).some((a) => a.customerAmount === -2.89)).toBe(true);
    // 同一个已处理的不能再处理
    expect(() => dp.winDispute(id, { refundCost: 1 }, "x")).toThrow(/处理过了/);
  });

  it("退给客户的金额可以自己填（0 = 不退），但不能超过客户在这一单上付的钱", () => {
    const s = db.getShipment(sid)!;
    const max = dp.refundableToCustomer(s);
    const id = dp.createDispute(sid, { reason: "燃油附加费重复收" }, "主管理员");
    expect(() => dp.winDispute(id, { refundCost: 1, refundCustomer: max + 1 }, "x")).toThrow(/不能超过/);
    expect(() => dp.winDispute(id, { refundCost: 0 }, "x")).toThrow(/服务商退回的金额/);
    const before = ledger.balanceOf(cid);
    dp.winDispute(id, { refundCost: 1.5, refundCustomer: 0 }, "主管理员");
    expect(ledger.balanceOf(cid)).toBe(before);
    const a = db.listAdjustments({ shipmentId: sid }).find((x) => x.costAmount === -1.5)!;
    expect(a).toMatchObject({ customerId: null, customerAmount: 0 });
    // 撤销处理结果：补差记录删掉，回到申诉中
    dp.reopenDispute(id);
    expect(db.listAdjustments({ shipmentId: sid }).some((x) => x.costAmount === -1.5)).toBe(false);
    expect(dp.getDispute(id)).toMatchObject({ status: "open", refundCost: null, adjustmentId: null });
    // 未成功要写结果；还在申诉中的可以删，处理过的不能删
    expect(() => dp.loseDispute(id, " ", "x")).toThrow(/写一句结果/);
    dp.loseDispute(id, "承运商复核后维持原费用", "主管理员");
    expect(dp.getDispute(id)).toMatchObject({ status: "lost", note: "承运商复核后维持原费用" });
    expect(() => dp.deleteDispute(id)).toThrow(/不能删除/);
  });

  it("撤销成功的申诉：退给客户的钱从余额扣回", () => {
    const won = dp.listDisputes({ status: "won" })[0];
    const before = ledger.balanceOf(cid);
    dp.reopenDispute(won.id);
    expect(ledger.balanceOf(cid)).toBeCloseTo(before - 2.89, 2);
    expect(db.getShipment(sid)!.customerAdj).toBeCloseTo(0, 2);
    dp.deleteDispute(won.id);
    expect(dp.getDispute(won.id)).toBeNull();
  });

  it("公司自用账户：只记成本，不退；英文客户看到英文说明", async () => {
    const house = db.houseCustomerId();
    const q = (await svc.quoteAll(house, req)).find((x) => x.ok)!;
    const id2 = await svc.createLabel({ customerId: house, channelCode: q.channelCode, req, expectedPrice: q.price!, waitForLabel: false });
    db.db().prepare("UPDATE shipments SET status = 'labeled' WHERE id = ?").run(id2);
    const d = dp.createDispute(id2, { reason: "重量收错" }, "主管理员");
    expect(dp.winDispute(d, { refundCost: 3, refundCustomer: 5 }, "x").refundCustomer).toBe(0);
    const { translateMessage } = await import("@/lib/i18n");
    expect(translateMessage("en", "运费申诉成功退回：超偏远费收错")).toMatch(/^Refund after a successful carrier dispute: /);
  });
});
