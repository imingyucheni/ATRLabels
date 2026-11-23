import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-manualtopup-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

describe("财务“最近处理”：后台直接记的充值也列出来", () => {
  it("只列后台直接记的充值；客户提交、审核通过的充值申请不重复列；扣款等其他流水不算", async () => {
    const db = await import("@/lib/db");
    const ledger = await import("@/lib/ledger");
    const tp = await import("@/lib/topup");
    const cid = db.saveCustomer(null, { name: "Elodie Han", contact: null, phone: null, email: null, note: null, markup: {} });
    // 客户提交、审核通过：充值申请里已经有，不再算“直接记账”
    const req = await tp.createTopup({ customerId: cid, method: "zelle", amountUsd: 50, reference: "Z1" });
    tp.approveTopup(req, 50, null, "staff:1");
    // 管理员在客户页面直接记一笔充值
    ledger.addLedger({ customerId: cid, type: "topup", amount: 322, note: "Zelle 到账", createdBy: "staff:1" });
    ledger.addLedger({ customerId: cid, type: "manual", amount: -5, note: "调账", createdBy: "admin" });
    const list = tp.listManualTopups();
    expect(list).toEqual([expect.objectContaining({ customerId: cid, customerName: "Elodie Han", amount: 322, note: "Zelle 到账", createdBy: "staff:1" })]);
  });
});
