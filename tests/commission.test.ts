import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-comm-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

describe("销售佣金", () => {
  let db: typeof import("@/lib/db");
  let cm: typeof import("@/lib/commission");
  let amy: number;
  let bob: number;
  let c1: number;
  let c2: number;
  const addr = { nameFirst: "A", nameLast: "B", address1: "1 Main St", city: "Austin", province: "TX", zipCode: "78701", country: "US" };

  /** 一张已出单的订单：利润 = price − cost；date 是本地日期（中午，避免时区跨天） */
  const ship = (customerId: number, date: string, price: number, cost: number, env = "live") => {
    const id = db.insertShipment({
      customNo: `T${Math.random().toString(36).slice(2, 10)}`, customerId, channelCode: "X", channelName: "X", sender: addr as never, recipient: addr as never,
      pkg: {} as never, skuList: [], quotedCost: cost, currency: "USD", zone: null, price, rule: {} as never, remark: null, env,
    });
    db.updateShipment(id, { status: "labeled" });
    const utc = new Date(`${date}T12:00:00`).toISOString().slice(0, 19).replace("T", " ");
    db.db().prepare("UPDATE shipments SET created_at = ? WHERE id = ?").run(utc, id);
    return id;
  };

  beforeAll(async () => {
    db = await import("@/lib/db");
    cm = await import("@/lib/commission");
    const base = { contact: null, phone: null, email: null, note: null, markup: {} };
    c1 = db.saveCustomer(null, { name: "客户一", ...base });
    c2 = db.saveCustomer(null, { name: "客户二", ...base });
    amy = cm.saveSales({ name: "Amy", rate: 30 });
    bob = cm.saveSales({ name: "Bob", rate: 50 });
  });

  it("销售资料：必填姓名、比例 0–100、不能重名", () => {
    expect(() => cm.saveSales({ name: " ", rate: 10 })).toThrow(/姓名/);
    expect(() => cm.saveSales({ name: "X", rate: 120 })).toThrow(/0–100/);
    expect(() => cm.saveSales({ name: "Amy", rate: 10 })).toThrow(/同名/);
  });

  it("分配“全部订单”：以前的单也算；按利润 × 比例；亏损冲减；测试单不算；比例不填用销售默认", () => {
    ship(c1, "2026-08-01", 10, 6); // 利润 4
    ship(c1, "2026-08-02", 5, 6); // 亏 1
    ship(c1, "2026-08-03", 100, 1, "test"); // 测试单
    cm.assignCustomer(c1, { salesId: amy, rate: null, startDate: "" });
    const lines = cm.commissionLines({ salesId: amy });
    expect(lines.map((l) => l.commission).sort()).toEqual([-0.3, 1.2]);
    expect(cm.salesSummaries().find((s) => s.rep.id === amy)).toMatchObject({ customers: 1, orders: 2, profit: 3, commission: 0.9, due: 0.9 });
    // 客户单独的比例优先
    cm.assignCustomer(c1, { salesId: amy, rate: 40, startDate: "" });
    expect(cm.salesSummaries().find((s) => s.rep.id === amy)!.commission).toBe(1.2);
  });

  it("换销售：生效日期之前的单还归原来的人", () => {
    ship(c2, "2026-08-10", 20, 10); // 利润 10
    ship(c2, "2026-09-10", 20, 10);
    cm.assignCustomer(c2, { salesId: amy, rate: null, startDate: "" });
    cm.assignCustomer(c2, { salesId: bob, rate: null, startDate: "2026-09-01" });
    expect(cm.commissionLines({ customerId: c2 }).map((l) => [l.date, l.salesId, l.commission])).toEqual([
      ["2026-09-10", bob, 5],
      ["2026-08-10", amy, 3],
    ]);
    expect(cm.currentAssignment(c2, "2026-09-02")!.salesId).toBe(bob);
    // 从某天起不再有销售
    cm.assignCustomer(c2, { salesId: null, rate: null, startDate: "2026-09-05" });
    expect(cm.commissionLines({ customerId: c2 }).map((l) => l.salesId)).toEqual([amy]);
  });

  it("结算：结清截止日前未结的；之后利润变了，差额进下一次；不会重复结", () => {
    const due = cm.salesSummaries().find((s) => s.rep.id === amy)!.due;
    const p = cm.settle(amy, "2026-08-31", "8 月", "admin")!;
    expect(p.amount).toBe(due);
    expect(cm.salesSummaries().find((s) => s.rep.id === amy)!.due).toBe(0);
    expect(cm.settle(amy, "2026-08-31", null, "admin")).toBeNull();
    // 8/1 那单后来补差：客户价变成 15（利润 9，佣金 3.6，原来 1.6）
    const first = cm.commissionLines({ salesId: amy }).find((l) => l.date === "2026-08-01")!;
    db.db().prepare("UPDATE shipments SET price = 15 WHERE id = ?").run(first.shipment.id);
    expect(cm.salesSummaries().find((s) => s.rep.id === amy)!.due).toBe(2);
    expect(cm.settle(amy, "2026-08-31", null, "admin")!.amount).toBe(2);
    expect(cm.listPayouts(amy).map((x) => x.amount)).toEqual([2, due]);
  });

  it("结算过的单后来改归别人：原来的人冲回，新的人照算", () => {
    cm.assignCustomer(c2, { salesId: bob, rate: null, startDate: "" }); // 8/10 那单改成全部归 Bob
    const amyLines = cm.commissionLines({ salesId: amy, customerId: c2 });
    expect(amyLines).toHaveLength(1);
    expect(amyLines[0]).toMatchObject({ commission: 0, paid: 3, due: -3 });
    expect(cm.commissionLines({ salesId: bob, customerId: c2 }).find((l) => l.date === "2026-08-10")!.commission).toBe(5);
  });
});
