import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-recon-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

const addr = { nameFirst: "A", nameLast: "B", country: "US", city: "Los Angeles", address1: "1 Main St", zipCode: "90058", province: "CA" };

describe("服务商对账", () => {
  let db: typeof import("@/lib/db");
  let recon: typeof import("@/lib/providerRecon");
  let cid: number;

  const mk = (channelCode: string, cost: number, patch: Parameters<typeof db.updateShipment>[1] = {}, env = "live") => {
    const id = db.insertShipment({
      customNo: `R-${Math.random().toString(36).slice(2, 10)}`, customerId: cid, channelCode, channelName: channelCode,
      sender: addr, recipient: addr, pkg: { length: 1, width: 1, height: 1, weight: 1, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
      skuList: [], quotedCost: cost, currency: "USD", zone: null, price: cost + 1, rule: { percent: 0, fixed: 1, minProfit: 0 },
      remark: null, customerRef: null, createdBy: "admin", env, addressCheck: null,
    });
    db.updateShipment(id, { status: "labeled", ...patch });
    return id;
  };

  beforeAll(async () => {
    db = await import("@/lib/db");
    recon = await import("@/lib/providerRecon");
    cid = db.saveCustomer(null, { name: "对账客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.upsertChannels([{ code: "LP-UNI", name: "UniUni-（91710） · SB" }, { code: "LP-USPS", name: "USPS-（91710） · SB" }, { code: "JG-580914", name: "USPS-D价 · GDE" }]);
  });

  it("按服务商、渠道统计出单数、邮费、取消费、补差；异常单单独列出，测试单不算", () => {
    mk("LP-UNI", 3.5);
    mk("LP-UNI", 4, { actualCost: 4.25 }); // 有实扣用实扣
    mk("LP-USPS", 6);
    mk("LP-USPS", 6, { status: "cancelled", sbCancelFee: 0.3 }); // 取消：只算取消费
    mk("LP-UNI", 9, { status: "exception" }); // 异常：不计入应付
    mk("LP-UNI", 99, {}, "sandbox"); // 沙盒测试单：不算
    const jg = mk("JG-580914", 5.1);

    // 补差：按导入日期算，归到订单所属的服务商
    db.db().prepare("INSERT INTO adjustment_batches (filename, file_hash, policy) VALUES ('bill.xlsx', 'h1', 'passthrough')").run();
    const batch = (db.db().prepare("SELECT id FROM adjustment_batches WHERE file_hash = 'h1'").get() as { id: number }).id;
    db.db().prepare("INSERT INTO adjustments (batch_id, row_no, match_key, shipment_id, customer_id, cost_amount, customer_amount) VALUES (?, 1, 'X', ?, ?, 0.8, 0.9)").run(batch, jg, cid);
    db.db().prepare("INSERT INTO adjustments (batch_id, row_no, match_key, cost_amount, customer_amount) VALUES (?, 2, 'NOPE', 1.5, 0)").run(batch);

    const today = new Date();
    const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const r = recon.buildRecon(d, d);
    const sb = r.providers.find((p) => p.key === "shipbest")!;
    const gde = r.providers.find((p) => p.key === "jiagu")!;

    expect(sb.totals).toMatchObject({ labels: 3, postage: 13.75, cancelled: 1, cancelFees: 0.3, adjustments: 0, exceptions: 1, exceptionCost: 9, total: 14.05 });
    const uni = sb.channels.find((c) => c.code === "LP-UNI")!;
    expect(uni).toMatchObject({ name: "UniUni-（91710）", labels: 2, postage: 7.75, exceptions: 1 });
    expect(sb.channels.find((c) => c.code === "LP-USPS")).toMatchObject({ labels: 1, postage: 6, cancelled: 1, cancelFees: 0.3, total: 6.3 });

    expect(gde.totals).toMatchObject({ labels: 1, postage: 5.1, adjustments: 0.8, adjCount: 1, total: 5.9 });
    expect(r.grand).toMatchObject({ labels: 4, postage: 18.85, total: 19.95 });
    expect(r.unmatchedAdj).toEqual({ count: 1, amount: 1.5 });
    // 按日明细加起来等于合计
    expect(sb.daily.reduce((a, x) => a + x.total, 0)).toBeCloseTo(sb.totals.total, 2);

    // 明细只含正式单，按服务商筛选
    expect(recon.reconShipments(d, d, "jiagu").map((s) => s.channelCode)).toEqual(["JG-580914"]);
    expect(recon.reconShipments(d, d).some((s) => s.quotedCost === 99)).toBe(false);
    // 别的日期没有记录
    expect(recon.buildRecon("2020-01-01", "2020-01-07").providers).toHaveLength(0);
  });

  it("对账周期：本周从周一开始，上周是完整的周一到周日", () => {
    const p = recon.reconPresets(new Date(2026, 8, 27)); // 2026-09-27 周日
    expect(p.find((x) => x.key === "week")).toMatchObject({ from: "2026-09-21", to: "2026-09-27" });
    expect(p.find((x) => x.key === "lastweek")).toMatchObject({ from: "2026-09-14", to: "2026-09-20" });
    expect(p.find((x) => x.key === "lastmonth")).toMatchObject({ from: "2026-08-01", to: "2026-08-31" });
  });
});
