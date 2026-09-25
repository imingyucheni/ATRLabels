/**
 * 寄件地址簿：每个客户可以保存多个寄件地址，其中一个是默认地址。
 * 默认地址同步到 customers.sender_json（批量导入表格没填寄件人时用它）。
 */
import { db, getCustomer, setCustomerSender } from "./db";
import type { Address } from "./shipbest/types";

export interface SavedSender {
  id: number;
  label: string;
  address: Address;
  isDefault: boolean;
}

function ensureTable() {
  const conn = db();
  conn.exec(`CREATE TABLE IF NOT EXISTS customer_senders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    address_json TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return conn;
}

/** 地址簿显示用的名称：没填名称时用 “姓名 · 城市” */
export function senderLabel(a: Partial<Address>, label?: string) {
  return (label ?? "").trim() || [`${a.nameFirst ?? ""} ${a.nameLast ?? ""}`.trim(), a.city].filter(Boolean).join(" · ") || "寄件地址";
}

export function listSenders(customerId: number): SavedSender[] {
  const conn = ensureTable();
  let rows = conn
    .prepare("SELECT * FROM customer_senders WHERE customer_id = ? ORDER BY is_default DESC, id")
    .all(customerId) as { id: number; label: string; address_json: string; is_default: number }[];
  // 老数据：只有一个默认寄件地址时，自动放进地址簿
  if (!rows.length) {
    const legacy = getCustomer(customerId)?.sender;
    if (legacy?.address1) {
      conn.prepare("INSERT INTO customer_senders (customer_id, label, address_json, is_default) VALUES (?,?,?,1)").run(customerId, senderLabel(legacy), JSON.stringify(legacy));
      rows = conn.prepare("SELECT * FROM customer_senders WHERE customer_id = ?").all(customerId) as typeof rows;
    }
  }
  return rows.map((r) => ({ id: r.id, label: r.label, address: JSON.parse(r.address_json), isDefault: !!r.is_default }));
}

export function getSender(customerId: number, id: number): SavedSender | null {
  return listSenders(customerId).find((s) => s.id === id) ?? null;
}

function syncDefault(customerId: number) {
  const list = listSenders(customerId);
  let def = list.find((s) => s.isDefault);
  if (!def && list.length) {
    db().prepare("UPDATE customer_senders SET is_default = 1 WHERE id = ?").run(list[0].id);
    def = list[0];
  }
  setCustomerSender(customerId, def?.address ?? null);
}

/** 新增或修改；makeDefault 时设为默认 */
export function saveSender(customerId: number, input: { id?: number; label?: string; address: Address; makeDefault?: boolean }): number {
  const conn = ensureTable();
  const label = senderLabel(input.address, input.label);
  const count = (conn.prepare("SELECT COUNT(*) AS n FROM customer_senders WHERE customer_id = ?").get(customerId) as { n: number }).n;
  if (!input.id && count >= 50) throw new Error("寄件地址最多保存 50 个");
  const id = conn.transaction(() => {
    let sid = input.id ?? 0;
    if (sid) {
      const r = conn.prepare("UPDATE customer_senders SET label = ?, address_json = ? WHERE id = ? AND customer_id = ?").run(label, JSON.stringify(input.address), sid, customerId);
      if (!r.changes) throw new Error("地址不存在");
    } else {
      sid = Number(conn.prepare("INSERT INTO customer_senders (customer_id, label, address_json) VALUES (?,?,?)").run(customerId, label, JSON.stringify(input.address)).lastInsertRowid);
    }
    if (input.makeDefault || count === 0) {
      conn.prepare("UPDATE customer_senders SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE customer_id = ?").run(sid, customerId);
    }
    return sid;
  })();
  syncDefault(customerId);
  return id;
}

export function setDefaultSender(customerId: number, id: number) {
  ensureTable().prepare("UPDATE customer_senders SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE customer_id = ?").run(id, customerId);
  syncDefault(customerId);
}

export function deleteSender(customerId: number, id: number) {
  ensureTable().prepare("DELETE FROM customer_senders WHERE id = ? AND customer_id = ?").run(id, customerId);
  syncDefault(customerId);
}
