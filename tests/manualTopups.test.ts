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

  it("管理员（不是主管理员）确认收钱的充值要主管理员核对；主管理员自己记的不用", async () => {
    const db = await import("@/lib/db");
    const ledger = await import("@/lib/ledger");
    const tp = await import("@/lib/topup");
    const cid = db.saveCustomer(null, { name: "核对客户", contact: null, phone: null, email: null, note: null, markup: {} });
    const staffId = ledger.addLedger({ customerId: cid, type: "topup", amount: 100, note: "现金", createdBy: "staff:2:Derek" });
    ledger.addLedger({ customerId: cid, type: "topup", amount: 80, note: "公司 Zelle", createdBy: "admin" });
    const req = await tp.createTopup({ customerId: cid, method: "zelle", amountUsd: 30, reference: "Z2" });
    tp.approveTopup(req, 30, null, "staff:2:Derek");
    // 管理员直接记的、管理员审核通过的充值申请都要核对；主管理员记的不用
    const open = tp.uncheckedStaffTopups().filter((m) => m.customerId === cid);
    expect(open.map((m) => [m.amount, m.createdBy])).toEqual([[100, "staff:2:Derek"], [30, "staff:2:Derek"]]);
    expect(tp.listManualTopups().find((m) => m.ledgerId === staffId)!.needsCheck).toBe(true);
    expect(tp.listManualTopups().find((m) => m.amount === 80 && m.customerId === cid)!.needsCheck).toBe(false);
    tp.checkStaffTopup(staffId, "已转回公司", "主管理员");
    tp.checkStaffTopup(staffId, "再点一次", "主管理员"); // 重复点不出错
    expect(tp.uncheckedStaffTopups().some((m) => m.ledgerId === staffId)).toBe(false);
    expect(tp.listManualTopups().find((m) => m.ledgerId === staffId)).toMatchObject({ needsCheck: false, checkedBy: "主管理员", checkNote: "已转回公司" });
    expect(() => tp.checkStaffTopup(999999, null, "x")).toThrow(/不存在/);
  });
});
