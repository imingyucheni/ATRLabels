import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-staffdash-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", country: "US", city: "Chino", address1: "1 Main St", zipCode: "91710", province: "CA", phone: "9095550100" },
  recipient: { nameFirst: "Jane", nameLast: "Roe", country: "US", city: "Austin", address1: "500 Congress Ave", zipCode: "78701", province: "TX", phone: "5125550100" },
  pkg: { length: 10, width: 8, height: 4, weight: 1, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "A1", productNameCn: "T恤", productNameEn: "T-shirt", quantity: 1, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 10, width: 8, height: 4, weight: 1, unit: 3 }],
};

describe("员工看板和提成", () => {
  let db: typeof import("@/lib/db");
  let svc: typeof import("@/lib/service");
  let com: typeof import("@/lib/commission");
  let st: typeof import("@/lib/staffStore");
  let dash: typeof import("@/lib/staffDashboard");
  let code: string;
  const today = new Date().toLocaleDateString("en-CA");
  const cust = (name: string) => db.saveCustomer(null, { name, contact: null, phone: null, email: null, note: null, markup: { percent: 20 } });
  /** 下一单，并改成正式单（模拟模式下的单都是测试单，看板不算） */
  const order = async (cid: number) => {
    const { addLedger } = await import("@/lib/ledger");
    addLedger({ customerId: cid, type: "topup", amount: 50, createdBy: "admin" });
    const q = await svc.quoteChannel(cid, code, req);
    const id = await svc.createLabel({ customerId: cid, channelCode: code, req, expectedPrice: q.price!, waitForLabel: false });
    db.db().prepare("UPDATE shipments SET env = 'live' WHERE id = ?").run(id);
    return db.getShipment(id)!;
  };

  beforeAll(async () => {
    db = await import("@/lib/db");
    svc = await import("@/lib/service");
    com = await import("@/lib/commission");
    st = await import("@/lib/staffStore");
    dash = await import("@/lib/staffDashboard");
    await import("@/lib/auth"); // 注册“公司自用账户”判断
    await svc.syncChannels();
    code = db.listChannels().filter((c) => !/HWT|MWT/.test(c.name) && !c.code.startsWith("DHL"))[0].code;
  });

  it("绑定销售：一个销售只能绑一个员工；客户要单独绑定，没绑定的利润归公司", () => {
    const a = st.createStaff({ name: "Sand", username: "sand", password: "sand-pass-1" });
    const b = st.createStaff({ name: "Bob", username: "bob", password: "bob-pass-1" });
    const rep = com.bindStaffSales(a, "Sand", "new")!;
    expect(rep).toMatchObject({ name: "Sand", rate: null, staffId: a });
    expect(com.salesOfStaff(a)?.id).toBe(rep.id);
    expect(() => com.bindStaffSales(b, "Bob", rep.id)).toThrow(/已经绑定了别的员工/);
    expect(com.bindStaffSales(a, "Sand", null)).toBeNull();
    expect(com.salesOfStaff(a)).toBeNull();
    com.bindStaffSales(a, "Sand", rep.id);
  });

  it("员工自己开的客户默认归他：按默认提成比例（30%）记在客户上；没绑定销售会自动新建；已经有销售的不动", () => {
    const c = st.createStaff({ name: "Cara", username: "cara", password: "cara-pass-1" });
    expect(com.salesOfStaff(c)).toBeNull();
    const cid = cust("Cara 开的客户");
    com.assignNewCustomerToStaff(cid, { id: c, name: "Cara" }, db.getSettings().staffCommissionRate);
    const rep = com.salesOfStaff(c)!;
    expect(rep.name).toBe("Cara");
    expect(com.currentAssignment(cid)).toMatchObject({ salesId: rep.id, rate: 30 });
    // 之后可以单独调整
    com.assignCustomer(cid, { salesId: rep.id, rate: 20, startDate: "" });
    expect(com.currentAssignment(cid)?.rate).toBe(20);
    com.assignNewCustomerToStaff(cid, { id: c, name: "Cara" }, 30);
    expect(com.currentAssignment(cid)?.rate).toBe(20);
  });

  it("看板只算自己负责的客户（授权的 + 归自己名下的），有成本、利润和自己的提成", async () => {
    const sid = st.listStaff().find((s) => s.username === "sand")!.id;
    const rep = com.salesOfStaff(sid)!;
    const granted = cust("授权客户");
    const assigned = cust("归我名下的客户");
    const other = cust("别人的客户");
    st.setStaffAccess(sid, { mode: "list", customers: { [String(granted)]: "view" } });
    // 提成按客户绑定：这个客户给 Sand 利润的 5%
    com.assignCustomer(assigned, { salesId: rep.id, rate: 5, startDate: "" });
    for (const c of [granted, assigned, other]) db.setCustomerChannels(c, [code]);
    const s1 = await order(granted);
    const s2 = await order(assigned);
    await order(other);
    const who = { role: "staff" as const, id: sid, name: "Sand", username: "sand" };
    const d = dash.staffDashboard(who, today, today);
    const names = d.customers.map((c) => c.name);
    expect(names).toContain("授权客户");
    expect(names).toContain("归我名下的客户");
    expect(names).not.toContain("别人的客户");
    expect(names).not.toContain(db.getCustomer(db.houseCustomerId())!.name);
    const p1 = db.shipmentProfit(s1)!;
    const p2 = db.shipmentProfit(s2)!;
    expect(d.totals.revenue).toBeCloseTo(s1.price + s2.price, 2);
    expect(d.totals.profit).toBeCloseTo(p1 + p2, 2);
    expect(d.customers.find((c) => c.name === "归我名下的客户")).toMatchObject({ mine: true, rate: 5 });
    // 授权给他、但没绑定销售的客户：利润归公司，不算提成
    expect(d.customers.find((c) => c.name === "授权客户")).toMatchObject({ mine: false, salesName: null, rate: null });
    expect(d.commission?.rep.id).toBe(rep.id);
    expect(d.commission?.commission).toBeCloseTo(Math.round(p2 * 5) / 100, 2);
    expect(d.commission?.noRate).toBe(0);
    expect(d.commission?.due).toBeCloseTo(d.commission!.commission, 2);
    expect(d.recent.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
  });
});
