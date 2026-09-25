import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

delete process.env.ATR_SINGLE_DB;
delete process.env.SHIPBEST_MOCK;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-env-"));

describe("正式 / 测试数据分开", async () => {
  const db = await import("@/lib/db");
  const ledger = await import("@/lib/ledger");
  it("测试模式下的充值、余额不会进正式数据；可以重置测试环境", () => {
    db.setStoredMode("live");
    expect(db.currentEnv()).toBe("live");
    const id = db.saveCustomer(null, { name: "真实客户", contact: null, phone: null, email: null, note: null, markup: {} });
    ledger.addLedger({ customerId: id, type: "topup", amount: 50, createdBy: "admin" });

    db.setStoredMode("sandbox");
    expect(db.currentEnv()).toBe("test");
    expect(db.getCustomer(id)?.name).toBe("真实客户"); // 客户从正式数据复制过来
    expect(ledger.balanceOf(id)).toBe(0); // 但流水是空的
    ledger.addLedger({ customerId: id, type: "topup", amount: 30, createdBy: "admin" });
    expect(ledger.balanceOf(id)).toBe(30);

    db.setStoredMode("live");
    expect(ledger.balanceOf(id)).toBe(50); // 测试充值没有进正式数据

    db.setStoredMode("mock");
    expect(ledger.balanceOf(id)).toBe(30);
    db.resetTestEnv();
    expect(ledger.balanceOf(id)).toBe(0);
    db.setStoredMode("live");
    expect(ledger.balanceOf(id)).toBe(50);
  });
});
