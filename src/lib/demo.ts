/**
 * 演示数据：设置 DEMO_SEED=1 时，空数据库第一次启动会自动创建。
 * 只用于测试，正式环境不要设置 DEMO_SEED。
 */
import type Database from "better-sqlite3";
import { hashPassword } from "./password";
import { presetForChannel } from "./stampConfig";

export const DEMO_ACCOUNTS = [
  { email: "demo@example.com", password: "demo1234", name: "演示客户 A（预付）" },
  { email: "monthly@example.com", password: "demo1234", name: "演示客户 B（月结 +8%）" },
];

export function seedDemo(conn: Database.Database) {
  const has = conn.prepare("SELECT COUNT(*) AS n FROM customers").get() as { n: number };
  if (has.n > 0) return;
  const set = conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  const settings: Record<string, unknown> = {
    markup: { percent: 5, fixed: 0, minProfit: 0.3 },
    roundingStep: 0.01,
    brandName: "ATR Logistics（演示）",
    supportContact: "演示环境 · 客服微信 atr-demo",
    zelleInfo: "Zelle：pay@atr-demo.com\n户名：ATR Logistics LLC（演示）",
    alipayInfo: "支付宝账号：atr-demo@example.com\n户名：演示公司",
    topupInstructions: "转账备注请写公司名称；工作日 2 小时内确认到账。",
    sender: { nameFirst: "ATR", nameLast: "Warehouse", country: "US", province: "CA", city: "Chino", address1: "13950 Central Ave", zipCode: "91710", phone: "9095550100" },
  };
  for (const [k, v] of Object.entries(settings)) set.run(k, JSON.stringify(v));

  const addCustomer = conn.prepare(
    `INSERT INTO customers (name, contact, email, portal_email, password_hash, portal_enabled, credit_limit, markup_percent)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  const a = Number(addCustomer.run(DEMO_ACCOUNTS[0].name, "Alice", DEMO_ACCOUNTS[0].email, DEMO_ACCOUNTS[0].email, hashPassword(DEMO_ACCOUNTS[0].password), 0, null).lastInsertRowid);
  const b = Number(addCustomer.run(DEMO_ACCOUNTS[1].name, "Bob", DEMO_ACCOUNTS[1].email, DEMO_ACCOUNTS[1].email, hashPassword(DEMO_ACCOUNTS[1].password), 500, 8).lastInsertRowid);
  const ledger = conn.prepare("INSERT INTO ledger (customer_id, type, amount, note, created_by) VALUES (?, 'topup', ?, ?, 'admin')");
  ledger.run(a, 200, "演示充值");

  // 模拟模式下直接放入渠道（真实模式请在“设置”里同步）
  if (process.env.SHIPBEST_MOCK === "1") {
    const ch = conn.prepare("INSERT OR IGNORE INTO channels (code, name, synced_at, stamp_json) VALUES (?, ?, datetime('now'), ?)");
    for (const [code, name] of [
      ["LP10210028", "UniUni-（91710）"], ["LP10210029", "GOFO-（91710）"], ["LP10210030", "USPS-（91710）"],
      ["LP10210433", "SwiftX-91710"], ["LP10210434", "YWE-91710"],
    ]) ch.run(code, name, presetForChannel(name) ? JSON.stringify(presetForChannel(name)) : null);
  }
  void b;
}
