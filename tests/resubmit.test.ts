import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-resubmit-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

const req = (weight: number): ShipmentRequest => ({
  sender: { nameFirst: "Ware", nameLast: "House", country: "US", city: "Los Angeles", address1: "1 Main St", zipCode: "90058", province: "CA", phone: "9095550100" },
  recipient: { nameFirst: "Jason", nameLast: "Menard", country: "US", city: "Omaha", address1: "2 Elm St", zipCode: "68104", province: "NE" },
  pkg: { length: 10, width: 8, height: 4, weight, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "A1", productNameCn: "T恤", productNameEn: "T-shirt", quantity: 1, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 10, width: 8, height: 4, weight, unit: 3 }],
});

describe("异常单修改后重新下单", () => {
  let db: typeof import("@/lib/db");
  let svc: typeof import("@/lib/service");
  let ledger: typeof import("@/lib/ledger");
  let sb: typeof import("@/lib/shipbest/client");
  let cid: number;

  /** 下一张单，然后模拟服务商返回异常 */
  async function failedOrder(sbStatus: number, ref: string) {
    const q = (await svc.quoteAll(cid, req(1))).find((x) => x.ok)!;
    const id = await svc.createLabel({ customerId: cid, channelCode: q.channelCode, req: req(1), expectedPrice: q.price!, customerRef: ref, waitForLabel: false });
    db.updateShipment(id, { status: "exception", sbStatus, errorMsg: "[10024] 包裹重量不在该渠道的下单重量范围内" });
    return db.getShipment(id)!;
  }

  async function resubmit(oldId: number, weight = 2.5) {
    const old = db.getShipment(oldId)!;
    const q = (await svc.quoteAll(cid, req(weight))).find((x) => x.ok && x.channelCode === old.channelCode)!;
    return svc.resubmitShipment({ oldId, channelCode: q.channelCode, req: req(weight), expectedPrice: q.price!, waitForLabel: false });
  }

  beforeAll(async () => {
    db = await import("@/lib/db");
    svc = await import("@/lib/service");
    ledger = await import("@/lib/ledger");
    sb = await import("@/lib/shipbest/client");
    await svc.syncChannels();
    cid = db.saveCustomer(null, { name: "重下客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(cid, db.listChannels().map((c) => c.code));
    ledger.addLedger({ customerId: cid, type: "topup", amount: 100, createdBy: "admin" });
  });

  it("用改好的重量下新单；原单向服务商取消成功，全额退回；新旧两单互相关联；同一订单号可以重下", async () => {
    const old = await failedOrder(3, "114-4632749-7321005");
    // 原单属于一个批量导入批次
    db.db().prepare("INSERT INTO batch_jobs (customer_id, created_by, filename, channel_mode, status) VALUES (?, 'admin', 'b.xlsx', 'cheapest', 'done')").run(cid);
    const job = (db.db().prepare("SELECT MAX(id) AS id FROM batch_jobs").get() as { id: number }).id;
    db.db().prepare("INSERT INTO batch_job_rows (job_id, row_no, customer_ref, req_json, status, shipment_id, price) VALUES (?, 2, ?, '{}', 'created', ?, ?)").run(job, old.customerRef, old.id, old.price);
    const before = ledger.balanceOf(cid);
    const r = await resubmit(old.id);
    expect(r.old).toBe("cancelled");
    const fresh = db.getShipment(r.id)!;
    expect(fresh.pkg.weight).toBe(2.5);
    expect(fresh.customerRef).toBe("114-4632749-7321005"); // 沿用原订单号
    expect(fresh.customerId).toBe(cid);
    const o = db.getShipment(old.id)!;
    expect(o).toMatchObject({ status: "cancelled", replacedBy: r.id, cancelFee: 0, refundAmount: old.price });
    expect(o.errorMsg).toContain(fresh.customNo);
    expect(db.replacedFrom(r.id)).toMatchObject({ id: old.id });
    // 批次里这一行跟着换成新单
    expect(db.db().prepare("SELECT shipment_id, price FROM batch_job_rows WHERE job_id = ?").get(job)).toEqual({ shipment_id: r.id, price: fresh.price });
    // 余额：扣新单、退原单
    expect(ledger.balanceOf(cid)).toBeCloseTo(before - fresh.price + old.price, 2);
    // 不能重复重下，也不能重下正常的单
    await expect(resubmit(old.id)).rejects.toThrow(/重新下过单/);
    await expect(resubmit(r.id)).rejects.toThrow(/只有出单异常或已取消/);
  });

  it("服务商拒绝取消、但那边本来就是异常单（没出面单）：本地取消并全额退回", async () => {
    const client = sb.getShipBestClient();
    const orig = client.cancelOrder.bind(client);
    client.cancelOrder = async () => { throw new sb.ShipBestError(11205, "Order exception, cancel not supported"); };
    try {
      const old = await failedOrder(3, "112-1");
      const r = await resubmit(old.id);
      expect(r.old).toBe("cancelled");
      expect(db.getShipment(old.id)).toMatchObject({ status: "cancelled", refundAmount: old.price, cancelFee: 0 });
    } finally {
      client.cancelOrder = orig;
    }
  });

  it("服务商拒绝取消、状态不明（例如嘉谷超时可能稍后出面单）：标记取消处理中，确认时取消费默认 0", async () => {
    const client = sb.getShipBestClient();
    const orig = client.cancelOrder.bind(client);
    client.cancelOrder = async () => { throw new sb.ShipBestError(11203, "The order was nonsupport cancelled!"); };
    try {
      const old = await failedOrder(2, "112-2");
      const r = await resubmit(old.id);
      expect(r.old).toBe("requested");
      const o = db.getShipment(old.id)!;
      expect(o.status).toBe("cancel_requested");
      expect(o.errorMsg).toContain("确认已取消");
      expect(svc.defaultCancelFees(o)).toEqual({ cancelFee: 0, sbCancelFee: 0 }); // 没出过面单
      const before = ledger.balanceOf(cid);
      svc.confirmCancelled(old.id, 0, 0);
      expect(ledger.balanceOf(cid)).toBeCloseTo(before + old.price, 2);
    } finally {
      client.cancelOrder = orig;
    }
  });

  it("已取消的单可以重新下单：订单号默认加 A / B，批次里这一行换成新单，不会再去取消原单", async () => {
    const q = (await svc.quoteAll(cid, req(1))).find((x) => x.ok)!;
    const id = await svc.createLabel({ customerId: cid, channelCode: q.channelCode, req: req(1), expectedPrice: q.price!, customerRef: "111-2574169-8848244", waitForLabel: false });
    db.updateShipment(id, { status: "cancelled" });
    expect(db.reorderRef(cid, "111-2574169-8848244")).toBe("111-2574169-8848244A");
    db.db().prepare("INSERT INTO batch_jobs (customer_id, created_by, filename, channel_mode, status) VALUES (?, 'customer', 'c.xlsx', 'cheapest', 'done')").run(cid);
    const job = (db.db().prepare("SELECT MAX(id) AS id FROM batch_jobs").get() as { id: number }).id;
    db.db().prepare("INSERT INTO batch_job_rows (job_id, row_no, customer_ref, req_json, status, shipment_id, price) VALUES (?, 3, ?, '{}', 'created', ?, ?)").run(job, "111-2574169-8848244", id, q.price);
    const client = sb.getShipBestClient();
    const orig = client.cancelOrder.bind(client);
    let cancelCalls = 0;
    client.cancelOrder = async (...a: Parameters<typeof orig>) => { cancelCalls++; return orig(...a); };
    try {
      const r = await svc.resubmitShipment({ oldId: id, channelCode: q.channelCode, req: req(1), expectedPrice: q.price!, customerRef: db.reorderRef(cid, "111-2574169-8848244"), createdBy: "customer", waitForLabel: false });
      expect(cancelCalls).toBe(0);
      expect(db.getShipment(r.id)!.customerRef).toBe("111-2574169-8848244A");
      expect(db.getShipment(id)!.replacedBy).toBe(r.id);
      expect((db.db().prepare("SELECT shipment_id FROM batch_job_rows WHERE job_id = ?").get(job) as { shipment_id: number }).shipment_id).toBe(r.id);
      // 新单也取消了再重下：接着排 B
      db.updateShipment(r.id, { status: "cancelled" });
      expect(db.reorderRef(cid, "111-2574169-8848244A")).toBe("111-2574169-8848244B");
      await expect(svc.resubmitShipment({ oldId: id, channelCode: q.channelCode, req: req(1), expectedPrice: q.price!, waitForLabel: false })).rejects.toThrow(/重新下过单/);
    } finally {
      client.cancelOrder = orig;
    }
  });
});
