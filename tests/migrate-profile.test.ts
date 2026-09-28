import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

// 旧版数据库：客户表还没有地址、联系人职位
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atr-mig-"));
const old = new Database(path.join(dir, "atrlabels.db"));
old.exec(`CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, contact TEXT, phone TEXT, email TEXT, note TEXT,
  markup_percent REAL, markup_fixed REAL, markup_min_profit REAL, created_at TEXT NOT NULL DEFAULT (datetime('now')), internal INTEGER NOT NULL DEFAULT 0);
INSERT INTO customers (name, contact, phone) VALUES ('测试客户A', '', NULL), ('测试客户B', 'Bob', '626-555-0101');
INSERT INTO customers (name, internal) VALUES ('公司自用（成本价）', 1);`);
old.close();
process.env.DATA_DIR = dir;
process.env.ATR_SINGLE_DB = "1";

describe("升级时补客户资料", () => {
  it("已有客户空着的资料填示例内容，已有的保留；公司自用账户不动", async () => {
    const db = await import("@/lib/db");
    expect(db.getCustomer(1)).toMatchObject({ contact: "测试客户A", contactTitle: "负责人（示例，请修改）", phone: "示例电话（请修改）" });
    expect(db.getCustomer(1)!.address).toContain("示例地址");
    expect(db.getCustomer(2)).toMatchObject({ contact: "Bob", phone: "626-555-0101" });
    expect(db.getCustomer(3)).toMatchObject({ address: null, contactTitle: null });
    // 新建的客户不会被补
    const id = db.saveCustomer(null, { name: "新客户", contact: "C", phone: "1", email: null, note: null, markup: {} });
    expect(db.getCustomer(id)).toMatchObject({ address: null, contactTitle: null });
  });
});
