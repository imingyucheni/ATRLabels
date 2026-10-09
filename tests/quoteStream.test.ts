import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atr-stream-"));
process.env.DATA_DIR = dir;
process.env.SHIPBEST_MOCK = "1";

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", phone: "9095550100", country: "US", city: "Ontario", address1: "1 Main St", zipCode: "91761", province: "CA" },
  recipient: { nameFirst: "John", nameLast: "Doe", phone: "5125550100", country: "US", city: "Austin", address1: "2 Elm St", zipCode: "73301", province: "TX" },
  pkg: { length: 10, width: 8, height: 4, weight: 2, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "A1", productNameCn: "T恤", productNameEn: "T-shirt", quantity: 1, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 10, width: 8, height: 4, weight: 2, unit: 3 }],
};

describe("边查边报（下单页查询运费）", () => {
  let db: typeof import("@/lib/db");
  let qs: typeof import("@/lib/quoteStream");
  let cid = 0;
  beforeAll(async () => {
    db = await import("@/lib/db");
    qs = await import("@/lib/quoteStream");
    const svc = await import("@/lib/service");
    await svc.syncChannels();
    cid = db.saveCustomer(null, { name: "流式客户", contact: null, phone: null, email: null, note: null, markup: { percent: 10 } });
    db.setCustomerChannels(cid, db.listChannels().filter((c) => !/HWT|MWT/.test(c.name)).map((c) => c.code));
  });

  const collect = async (who: import("@/lib/quoteStream").QuoteStreamWho, input: import("@/lib/quoteStream").QuoteStreamInput) => {
    const events: import("@/lib/quoteStream").QuoteStreamEvent[] = [];
    await qs.runQuoteStream(who, input, (e) => events.push(e));
    return events;
  };

  it("客户：先告诉要查哪些渠道，每个渠道查完发一次，最后发完整列表；地址核对单独发；看不到成本和用时", async () => {
    const ev = await collect({ kind: "customer", customerId: cid }, { mode: "portal", req });
    const types = ev.map((e) => e.t);
    expect(types[0]).toBe("start");
    const start = ev[0] as { t: "start"; channels: { code: string; name: string }[] };
    const each = ev.filter((e) => e.t === "q");
    expect(each.length).toBe(start.channels.length);
    expect(types).toContain("done");
    expect(types).toContain("addr");
    const done = ev.find((e) => e.t === "done") as { t: "done"; quotes: Record<string, unknown>[] };
    expect(done.quotes.length).toBe(start.channels.length);
    for (const q of [...done.quotes, ...each.map((e) => (e as { q: Record<string, unknown> }).q)]) {
      expect(q).not.toHaveProperty("cost");
      expect(q).not.toHaveProperty("profit");
      expect(q).not.toHaveProperty("ms");
    }
    // 客户看到的渠道名不带“· SB”
    expect(start.channels.every((c) => !/·\s*SB/.test(c.name))).toBe(true);
  });

  it("后台：主管理员看得到成本和每个渠道的用时；员工看得到授权客户的成本（没有用时）；没有这个客户权限的员工被拒绝", async () => {
    const owner = { kind: "admin" as const, admin: { role: "owner" as const, id: 0 as const, name: "主管理员" } };
    const ev = await collect(owner, { mode: "admin", customerId: cid, req });
    const done = ev.find((e) => e.t === "done") as { quotes: { ok: boolean; cost?: number; ms?: number }[] };
    expect(done.quotes.some((q) => q.ok && q.cost! > 0)).toBe(true);
    expect(done.quotes.every((q) => typeof q.ms === "number")).toBe(true);
    expect(ev.some((e) => e.t === "addr")).toBe(false); // 运费试算不核对地址

    const { createStaff } = await import("@/lib/staffStore");
    const sid = createStaff({ name: "试算员工", username: "stream_staff", password: "password123" });
    const staff = { kind: "admin" as const, admin: { role: "staff" as const, id: sid, name: "试算员工", username: "stream_staff" } };
    const denied = await collect(staff, { mode: "admin", customerId: cid, req });
    expect(denied).toEqual([{ t: "err", errors: ["你没有这个客户的权限，请找主管理员授权"] }]);
    const { grantCustomer } = await import("@/lib/staffStore");
    grantCustomer(sid, cid, "view");
    const ok = await collect(staff, { mode: "admin", customerId: cid, req });
    const d2 = ok.find((e) => e.t === "done") as { quotes: Record<string, unknown>[] };
    expect(d2.quotes.some((q) => q.ok && typeof q.cost === "number" && typeof q.profit === "number")).toBe(true);
    expect(d2.quotes.every((q) => q.ms === undefined)).toBe(true);
    // 员工不能用“管理员下单”（成本价）
    expect(await collect(staff, { mode: "house", req })).toEqual([{ t: "err", errors: ["只有主管理员可以这样操作"] }]);
  });

  it("填写有问题：直接返回错误，不去查价", async () => {
    const bad = { ...req, recipient: { ...req.recipient, zipCode: "" } };
    const ev = await collect({ kind: "customer", customerId: cid }, { mode: "portal", req: bad });
    expect(ev.length).toBe(1);
    expect(ev[0].t).toBe("err");
  });
});
