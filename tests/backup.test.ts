import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-backup-"));

describe("数据备份与恢复", async () => {
  const db = await import("@/lib/db");
  const ledger = await import("@/lib/ledger");
  const bk = await import("@/lib/backup");
  it("手动备份 → 改数据 → 恢复回备份时的状态，恢复前自动另存", () => {
    const id = db.saveCustomer(null, { name: "备份客户", contact: null, phone: null, email: null, note: null, markup: {} });
    ledger.addLedger({ customerId: id, type: "topup", amount: 100, createdBy: "admin" });
    fs.mkdirSync(path.join(db.rootDir(), "labels"), { recursive: true });
    fs.writeFileSync(path.join(db.rootDir(), "labels", "A1.pdf"), "%PDF-1");
    const name = bk.createBackup("manual");
    expect(bk.listBackups().map((b) => b.name)).toContain(name);

    ledger.addLedger({ customerId: id, type: "manual", amount: -30, note: "x", createdBy: "admin" });
    fs.rmSync(path.join(db.rootDir(), "labels", "A1.pdf"));
    expect(ledger.balanceOf(id)).toBe(70);

    const { safety } = bk.restoreBackup(name);
    expect(ledger.balanceOf(id)).toBe(100);
    expect(fs.existsSync(path.join(db.rootDir(), "labels", "A1.pdf"))).toBe(true);
    expect(bk.listBackups().find((b) => b.name === safety)?.kind).toBe("before-restore");

    bk.restoreBackup(safety);
    expect(ledger.balanceOf(id)).toBe(70);
    expect(() => bk.backupPath("../etc/passwd")).toThrow();
  });
});
