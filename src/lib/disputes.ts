/**
 * 运费申诉：我们或客户觉得哪笔运费 / 附加费收错了，向服务商（嘉谷、ShipBest）客服提交申诉；
 * 申诉成功、服务商把钱退给我们后，也退给客户。
 * - 记录申诉（申诉中）→ 成功：填服务商退回的金额，按这一单的加价比例退给客户（可以改），记入客户余额；
 *   未成功：写一句结果关掉。
 * - 退款记成一笔补差（成本 = 服务商退回，客户 = 退给客户），客户的补差明细、对账单、利润、服务商对账都跟着变。
 */
import { db, getShipment, insertAdjustmentBatch, isInternalCustomer, shipmentReceivable, type Shipment } from "./db";
import { postAdjustment } from "./ledger";
import { isJiaguCode } from "./shipbest/jiagu";
import { isDhlCode } from "./shipbest/dhl";

const providerOf = (code: string) => (isDhlCode(code) ? "DHL" : isJiaguCode(code) ? "嘉谷" : "ShipBest");

export type DisputeStatus = "open" | "won" | "lost";

export const DISPUTE_STATUS_LABEL: Record<DisputeStatus, string> = { open: "申诉中", won: "申诉成功", lost: "未成功" };

/** 客户看到的退款说明开头（后面接申诉内容） */
export const DISPUTE_REFUND_PREFIX = "运费申诉成功退回：";

export interface Dispute {
  id: number;
  shipmentId: number;
  provider: string;
  status: DisputeStatus;
  /** 申诉什么（客户看得到：退款时作为说明） */
  reason: string;
  /** 申诉的金额（可以不填） */
  claimAmount: number | null;
  /** 服务商退给我们的 */
  refundCost: number | null;
  /** 退给客户的 */
  refundCustomer: number | null;
  adjustmentId: number | null;
  /** 内部备注（申诉单号、和客服的沟通等，客户看不到） */
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  customNo?: string;
  trackingNo?: string | null;
  customerId?: number;
  customerName?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function ensureTable() {
  const conn = db();
  conn.exec(`CREATE TABLE IF NOT EXISTS disputes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    reason TEXT NOT NULL,
    claim_amount REAL,
    refund_cost REAL,
    refund_customer REAL,
    adjustment_id INTEGER REFERENCES adjustments(id) ON DELETE SET NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT,
    resolved_at TEXT,
    resolved_by TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_disputes_ship ON disputes(shipment_id);
  CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status)`);
  return conn;
}

function toDispute(r: Record<string, unknown>): Dispute {
  return {
    id: r.id as number, shipmentId: r.shipment_id as number, provider: r.provider as string, status: r.status as DisputeStatus,
    reason: r.reason as string, claimAmount: (r.claim_amount as number) ?? null, refundCost: (r.refund_cost as number) ?? null,
    refundCustomer: (r.refund_customer as number) ?? null, adjustmentId: (r.adjustment_id as number) ?? null, note: (r.note as string) ?? null,
    createdAt: r.created_at as string, createdBy: (r.created_by as string) ?? null, resolvedAt: (r.resolved_at as string) ?? null, resolvedBy: (r.resolved_by as string) ?? null,
    ...(r.custom_no !== undefined ? { customNo: r.custom_no as string, trackingNo: (r.tracking_no as string) ?? null, customerId: r.customer_id as number, customerName: r.customer_name as string } : {}),
  };
}

export function listDisputes(f: { status?: DisputeStatus; shipmentId?: number; limit?: number } = {}): Dispute[] {
  const conn = ensureTable();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.status) { where.push("d.status = ?"); args.push(f.status); }
  if (f.shipmentId) { where.push("d.shipment_id = ?"); args.push(f.shipmentId); }
  return (conn
    .prepare(
      `SELECT d.*, s.custom_no, s.tracking_no, s.customer_id, c.name AS customer_name FROM disputes d
       JOIN shipments s ON s.id = d.shipment_id JOIN customers c ON c.id = s.customer_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY d.id DESC LIMIT ?`,
    )
    .all(...args, f.limit ?? 500) as Record<string, unknown>[]).map(toDispute);
}

export function getDispute(id: number): Dispute | null {
  const r = ensureTable().prepare("SELECT * FROM disputes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return r ? toDispute(r) : null;
}

export function openDisputeCount(): number {
  return (ensureTable().prepare("SELECT COUNT(*) AS n FROM disputes WHERE status = 'open'").get() as { n: number }).n;
}

/** 记录一笔申诉 */
export function createDispute(shipmentId: number, input: { reason: string; claimAmount?: number | null; note?: string | null }, by: string): number {
  const s = getShipment(shipmentId);
  if (!s) throw new Error("订单不存在");
  const reason = input.reason.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!reason) throw new Error("请写申诉的是哪笔费用，例如“超偏远费收错，地址不是偏远地区”");
  const claim = input.claimAmount === null || input.claimAmount === undefined || !Number.isFinite(input.claimAmount) ? null : r2(input.claimAmount);
  if (claim !== null && claim <= 0) throw new Error("申诉金额要大于 0（不确定可以不填）");
  const r = ensureTable()
    .prepare("INSERT INTO disputes (shipment_id, provider, reason, claim_amount, note, created_by) VALUES (?, ?, ?, ?, ?, ?)")
    .run(shipmentId, providerOf(s.channelCode), reason, claim, input.note?.trim().slice(0, 500) || null, by);
  return Number(r.lastInsertRowid);
}

/** 这一单客户付了多少（运费 + 补收 - 已退的），申诉退款最多退到这么多 */
export function refundableToCustomer(s: Shipment): number {
  return Math.max(0, r2(shipmentReceivable(s)));
}

/** 默认退给客户多少：服务商退回 × (1 + 这一单的加价 %)，舍去零头，最多退到客户在这单上付的钱；公司自用账户 0 */
export function suggestCustomerRefund(s: Shipment, refundCost: number): number {
  if (isInternalCustomer(s.customerId)) return 0;
  const pct = Math.max(0, s.rule?.percent ?? 0);
  const cents = Math.round(refundCost * (1 + pct / 100) * 100 * 1e4) / 1e4;
  return Math.min(Math.floor(cents) / 100, refundableToCustomer(s));
}

/** 申诉退款记在哪个补差批次：一个月一个（“运费申诉退款 2026-11”），补差页的导入记录里能看到 */
function disputeBatch(): number {
  const month = new Date().toISOString().slice(0, 7);
  const hash = `dispute:${month}`;
  const hit = db().prepare("SELECT id FROM adjustment_batches WHERE file_hash = ?").get(hash) as { id: number } | undefined;
  if (hit) return hit.id;
  return insertAdjustmentBatch({ filename: `运费申诉退款 ${month}`, fileHash: hash, policy: "with_markup", note: `运费申诉退款 ${month}`, header: ["运单号"] }, []);
}

/**
 * 申诉成功：服务商退给我们 refundCost；退给客户 refundCustomer（不填按加价比例算）。
 * 记一笔补差（成本、客户都是负数），客户余额马上加回，并通知客户。
 */
export function winDispute(id: number, input: { refundCost: number; refundCustomer?: number | null; note?: string | null }, by: string) {
  const d = getDispute(id);
  if (!d) throw new Error("申诉记录不存在");
  if (d.status !== "open") throw new Error("这笔申诉已经处理过了");
  const s = getShipment(d.shipmentId)!;
  const cost = r2(Number(input.refundCost));
  if (!Number.isFinite(cost) || cost <= 0) throw new Error("请填服务商退回的金额（大于 0）");
  const max = refundableToCustomer(s);
  const internal = isInternalCustomer(s.customerId);
  const given = input.refundCustomer;
  const cust = internal ? 0 : given === null || given === undefined || !Number.isFinite(given) ? suggestCustomerRefund(s, cost) : r2(given);
  if (cust < 0) throw new Error("退给客户的金额不能是负数（不退填 0）");
  if (cust > max + 0.001) throw new Error(`退给客户的金额不能超过客户在这一单上付的 ${max.toFixed(2)}`);
  const conn = ensureTable();
  const reason = `${DISPUTE_REFUND_PREFIX}${d.reason}`;
  const adjId = conn.transaction(() => {
    const batchId = disputeBatch();
    const rowNo = ((conn.prepare("SELECT MAX(row_no) AS n FROM adjustments WHERE batch_id = ?").get(batchId) as { n: number | null }).n ?? 0) + 1;
    const a = conn
      .prepare(
        `INSERT INTO adjustments (batch_id, row_no, match_key, shipment_id, customer_id, cost_amount, customer_amount, reason, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(batchId, rowNo, s.trackingNo || s.customNo, s.id, cust > 0 ? s.customerId : null, -cost, -cust, reason, JSON.stringify([s.trackingNo || s.customNo]));
    const adj = Number(a.lastInsertRowid);
    conn
      .prepare("UPDATE disputes SET status = 'won', refund_cost = ?, refund_customer = ?, adjustment_id = ?, note = COALESCE(?, note), resolved_at = datetime('now'), resolved_by = ? WHERE id = ?")
      .run(cost, cust, adj, input.note?.trim().slice(0, 500) || null, by, id);
    return adj;
  })();
  // 客户余额加回（并按补差通知客户）
  if (cust > 0) postAdjustment(adjId, s.customerId, s.id, -cust, reason);
  return { refundCost: cost, refundCustomer: cust };
}

/** 申诉未成功：写一句结果关掉 */
export function loseDispute(id: number, note: string, by: string) {
  const d = getDispute(id);
  if (!d) throw new Error("申诉记录不存在");
  if (d.status !== "open") throw new Error("这笔申诉已经处理过了");
  const n = note.trim().slice(0, 500);
  if (!n) throw new Error("请写一句结果，例如“客服说承运商复核后维持原费用”");
  ensureTable().prepare("UPDATE disputes SET status = 'lost', note = ?, resolved_at = datetime('now'), resolved_by = ? WHERE id = ?").run(n, by, id);
}

/** 撤销处理结果（填错了）：退款记录和客户余额里的退款一起撤回，回到“申诉中” */
export function reopenDispute(id: number) {
  const d = getDispute(id);
  if (!d) throw new Error("申诉记录不存在");
  if (d.status === "open") return;
  const conn = ensureTable();
  conn.transaction(() => {
    if (d.adjustmentId) {
      conn.prepare("DELETE FROM ledger WHERE adjustment_id = ?").run(d.adjustmentId);
      conn.prepare("DELETE FROM adjustments WHERE id = ?").run(d.adjustmentId);
    }
    conn.prepare("UPDATE disputes SET status = 'open', refund_cost = NULL, refund_customer = NULL, adjustment_id = NULL, resolved_at = NULL, resolved_by = NULL WHERE id = ?").run(id);
  })();
}

/** 删掉一笔还在申诉中的记录（记错了单） */
export function deleteDispute(id: number) {
  const d = getDispute(id);
  if (!d) return;
  if (d.status !== "open") throw new Error("已经处理过的申诉不能删除，请先撤销处理结果");
  ensureTable().prepare("DELETE FROM disputes WHERE id = ?").run(id);
}
