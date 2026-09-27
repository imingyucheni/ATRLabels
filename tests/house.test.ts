import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-house-"));
process.env.SHIPBEST_MOCK = "1";

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", country: "US", city: "Los Angeles", address1: "1 Main St", zipCode: "90058", province: "CA" },
  recipient: { nameFirst: "John", nameLast: "Doe", country: "US", city: "Austin", address1: "2 Elm St", zipCode: "73301", province: "TX" },
  pkg: { length: 10, width: 8, height: 4, weight: 2, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "A1", productNameCn: "T恤", productNameEn: "T-shirt", quantity: 1, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 10, width: 8, height: 4, weight: 2, unit: 3 }],
};

describe("管理员下单（公司自用账户，成本价）", () => {
  let db: typeof import("@/lib/db");
  let svc: typeof import("@/lib/service");
  let ledger: typeof import("@/lib/ledger");

  beforeAll(async () => {
    db = await import("@/lib/db");
    svc = await import("@/lib/service");
    ledger = await import("@/lib/ledger");
    db.saveSettings({ markup: { percent: 20, fixed: 1, minProfit: 0.5 }, roundingStep: 0.1 });
    await svc.syncChannels();
  });

  it("所有已启用渠道都报价，价格 = 成本；不在客户列表里", async () => {
    const id = db.houseCustomerId();
    expect(db.houseCustomerId()).toBe(id); // 只建一个
    expect(db.listCustomers().some((c) => c.id === id)).toBe(false);
    expect(db.listCustomers({ includeInternal: true }).some((c) => c.id === id)).toBe(true);
    const quotes = await svc.quoteAll(id, req);
    expect(quotes.length).toBe(db.listChannels(true).length); // 没有开通限制
    for (const q of quotes.filter((x) => x.ok)) {
      expect(q.price).toBe(q.cost); // 不加价、不取整
      expect(q.profit).toBe(0);
    }
  });

  it("出单不扣余额，取消不退款流水", async () => {
    const id = db.houseCustomerId();
    const q = (await svc.quoteAll(id, req)).find((x) => x.ok)!;
    const sid = await svc.createLabel({ customerId: id, channelCode: q.channelCode, req, expectedPrice: q.price!, createdBy: "admin", waitForLabel: false });
    const s = db.getShipment(sid)!;
    expect(s.price).toBe(q.cost);
    expect(ledger.balanceOf(id)).toBe(0);
    expect(ledger.listLedger({ customerId: id }).length).toBe(0);
    await svc.requestCancel(sid).catch(() => null);
    expect(ledger.listLedger({ customerId: id }).length).toBe(0);
  });

  it("普通客户照旧加价", async () => {
    const cid = db.saveCustomer(null, { name: "普通客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(cid, db.listChannels().map((c) => c.code));
    const q = (await svc.quoteAll(cid, req)).find((x) => x.ok)!;
    expect(q.price!).toBeGreaterThan(q.cost!);
  });

  it("批量导入：所有渠道比价、按成本价出单、不扣余额", async () => {
    const batch = await import("@/lib/batch");
    const { readSheetRows } = await import("@/lib/adjustments");
    const id = db.houseCustomerId();
    const rows = await readSheetRows("t.xlsx", await batch.buildTemplate(req.sender, { examplesInFirstSheet: true }), "first");
    const { orders, error } = batch.parseOrders(rows, batch.senderFor(id));
    expect(error).toBeFalsy();
    const ok = orders.filter((o) => !o.errors.length);
    expect(ok.length).toBeGreaterThan(0);
    const jobId = batch.createJob({ customerId: id, createdBy: "admin", filename: "t.xlsx", channels: [], pickMode: "cheapest", orders: ok });
    batch.ensureRunning(jobId);
    const wait = async (st: string[]) => {
      for (let i = 0; i < 150; i++) {
        const j = batch.getJob(jobId)!;
        if (st.includes(j.status)) return j;
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error("timeout " + batch.getJob(jobId)!.status);
    };
    let job = await wait(["ready"]);
    const quoted = job.rows.filter((r) => r.status === "quoted");
    expect(quoted.length).toBeGreaterThan(0);
    // 每单都按所有已启用渠道试算，价格 = 成本
    expect(quoted[0].quotes.length).toBe(db.listChannels(true).length);
    for (const q of quoted[0].quotes.filter((x) => x.ok)) expect(q.price).toBe(q.cost);
    batch.setSelected(jobId, "all");
    batch.confirmJob(jobId);
    job = await wait(["done", "ready"]);
    expect(job.rows.filter((r) => r.status === "created").length).toBe(quoted.length);
    expect(ledger.listLedger({ customerId: id }).length).toBe(0);
  }, 60_000);
});

describe("嘉谷缺分区时按同一目的地补上（参考）", () => {
  it("一次比价里用其他渠道的分区补；有自己的分区就不动", async () => {
    const svc = await import("@/lib/service");
    const base = { ok: true, currency: "USD" } as const;
    const res = svc.fillZones([
      { ...base, channelCode: "JG-579181", channelName: "GOFO", zone: null },
      { ...base, channelCode: "JG-580914", channelName: "FedEx", zone: "zone7" },
      { ...base, channelCode: "LP-USPS", channelName: "USPS", zone: "zone6" },
    ] as never);
    expect(res[0]).toMatchObject({ zone: "zone6", zoneEstimated: true });
    expect(res[1]).toMatchObject({ zone: "zone7" });
    expect(res[1].zoneEstimated).toBeUndefined();
  });

  it("单独报价时用最近同邮编的分区补", async () => {
    const svc = await import("@/lib/service");
    expect(svc.zoneOf("LP-USPS", "10001-1234", "zone8")).toEqual({ zone: "zone8" });
    expect(svc.zoneOf("JG-579181", "10001", null)).toEqual({ zone: "zone8", zoneEstimated: true });
    expect(svc.zoneOf("JG-579181", "99999", null)).toEqual({ zone: null });
  });
});
