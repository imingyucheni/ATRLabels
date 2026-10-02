/**
 * 下单草稿：填了一半、还没确认出单的订单先存起来，下次接着填，不用重新输入。
 * 按客户保存（管理员自用下单存在公司自用账户下），换电脑 / 手机也能看到。
 * 只是表单内容，不报价、不扣费；出单成功后自动删掉。
 */
import { db } from "./db";
import { fmtTime } from "./time";
import type { ShipmentRequest } from "./shipbest/types";

export const MAX_DRAFTS = 50;
const MAX_BYTES = 64 * 1024;

export interface OrderDraft {
  id: number;
  intl: boolean;
  title: string;
  request: ShipmentRequest;
  customerRef: string;
  remark: string;
  updatedAt: string;
}

function ensureTable() {
  const conn = db();
  conn.exec(`CREATE TABLE IF NOT EXISTS order_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    intl INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return conn;
}

type Row = { id: number; intl: number; title: string; data_json: string; updated_at: string };

function toDraft(r: Row): OrderDraft {
  const d = JSON.parse(r.data_json) as { request: ShipmentRequest; customerRef?: string; remark?: string };
  return { id: r.id, intl: !!r.intl, title: r.title, request: d.request, customerRef: d.customerRef ?? "", remark: d.remark ?? "", updatedAt: r.updated_at };
}

/** 列表里显示的名字：订单号 > 收件人 · 城市 > “未填收件人” */
export function draftTitle(req: Partial<ShipmentRequest>, customerRef?: string): string {
  const r = req.recipient;
  const who = [`${r?.nameFirst ?? ""} ${r?.nameLast ?? ""}`.trim(), r?.city].filter(Boolean).join(" · ");
  return [customerRef?.trim(), who].filter(Boolean).join(" · ").slice(0, 80) || "未填收件人";
}

export function listDrafts(customerId: number, intl?: boolean): OrderDraft[] {
  const rows = ensureTable()
    .prepare(`SELECT * FROM order_drafts WHERE customer_id = ? ${intl === undefined ? "" : "AND intl = ?"} ORDER BY updated_at DESC, id DESC`)
    .all(...(intl === undefined ? [customerId] : [customerId, intl ? 1 : 0])) as Row[];
  return rows.map(toDraft);
}

export function getDraft(customerId: number, id: number): OrderDraft | null {
  if (!(id > 0)) return null;
  const r = ensureTable().prepare("SELECT * FROM order_drafts WHERE id = ? AND customer_id = ?").get(id, customerId) as Row | undefined;
  return r ? toDraft(r) : null;
}

const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** 草稿可以是填了一半的：只保证结构对（地址、包裹是对象，商品是数组），内容原样存 */
export function normalizeDraftRequest(v: unknown): ShipmentRequest {
  const r = obj(v);
  return {
    sender: obj(r.sender),
    recipient: obj(r.recipient),
    pkg: obj(r.pkg),
    skuList: Array.isArray(r.skuList) ? r.skuList.slice(0, 100).map(obj) : [],
  } as unknown as ShipmentRequest;
}

/** 新建或更新（id 是别的客户的 / 已删掉 → 新建一条） */
export function saveDraft(customerId: number, input: { id?: number; intl: boolean; request: ShipmentRequest; customerRef?: string; remark?: string }): number {
  const conn = ensureTable();
  const customerRef = String(input.customerRef ?? "").slice(0, 50);
  const remark = String(input.remark ?? "").slice(0, 200);
  const request = normalizeDraftRequest(input.request);
  const data = JSON.stringify({ request, customerRef, remark });
  if (data.length > MAX_BYTES) throw new Error("草稿内容太多，保存不了");
  const title = draftTitle(request, customerRef);
  if (input.id && getDraft(customerId, input.id)) {
    conn.prepare("UPDATE order_drafts SET intl = ?, title = ?, data_json = ?, updated_at = datetime('now') WHERE id = ? AND customer_id = ?").run(input.intl ? 1 : 0, title, data, input.id, customerId);
    return input.id;
  }
  const n = (conn.prepare("SELECT COUNT(*) AS n FROM order_drafts WHERE customer_id = ?").get(customerId) as { n: number }).n;
  if (n >= MAX_DRAFTS) throw new Error("草稿最多保存 50 个，请先删掉一些");
  return Number(conn.prepare("INSERT INTO order_drafts (customer_id, intl, title, data_json) VALUES (?,?,?,?)").run(customerId, input.intl ? 1 : 0, title, data).lastInsertRowid);
}

export function deleteDraft(customerId: number, id: number): boolean {
  return ensureTable().prepare("DELETE FROM order_drafts WHERE id = ? AND customer_id = ?").run(id, customerId).changes > 0;
}

/** 下单页上方草稿列表用：国内、国际草稿都列出来，链接到各自的下单页 */
export function draftRows(customerId: number, pages: { us: string; intl: string }) {
  return listDrafts(customerId).map((d) => ({ id: d.id, title: d.title, time: fmtTime(d.updatedAt), href: `${d.intl ? pages.intl : pages.us}?draft=${d.id}` }));
}
