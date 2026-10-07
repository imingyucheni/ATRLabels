/**
 * 多箱寄出的开放范围：默认不开放，后台在客户详情 → 渠道与价格里逐个客户开放。
 * 开放了、并且开通了多箱渠道（UPS HWT / FedEx MWT）的客户，OMS 里才有“多箱寄出”。
 */
import { db } from "./db";

function conn() {
  const c = db();
  c.exec(`CREATE TABLE IF NOT EXISTS multi_access (
    customer_id INTEGER PRIMARY KEY,
    enabled_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return c;
}

export function multiEnabled(customerId: number): boolean {
  return !!conn().prepare("SELECT 1 FROM multi_access WHERE customer_id = ?").get(customerId);
}

export function setMultiEnabled(customerId: number, on: boolean) {
  if (on) conn().prepare("INSERT OR IGNORE INTO multi_access (customer_id) VALUES (?)").run(customerId);
  else conn().prepare("DELETE FROM multi_access WHERE customer_id = ?").run(customerId);
}
