import { db, getCustomer } from "./db";

/**
 * 客户钱包流水。余额 = 流水合计。
 * 正数 = 增加客户余额（充值、退款、补差退还），负数 = 扣款（出单、补差补收）。
 */
export type LedgerType = "topup" | "label" | "refund" | "adjustment" | "manual";

export const LEDGER_TYPE_LABEL: Record<LedgerType, string> = {
  topup: "充值",
  label: "出单扣款",
  refund: "取消退款",
  adjustment: "账单补差",
  manual: "手动调账",
};

export interface LedgerEntry {
  id: number;
  customerId: number;
  customerName?: string;
  type: LedgerType;
  amount: number;
  shipmentId: number | null;
  customNo?: string | null;
  trackingNo?: string | null;
  adjustmentId: number | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  /** 这笔之后的余额（仅按客户查询时计算） */
  balanceAfter?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function balanceOf(customerId: number): number {
  const r = db().prepare("SELECT COALESCE(SUM(amount), 0) AS b FROM ledger WHERE customer_id = ?").get(customerId) as { b: number };
  return round2(r.b);
}

export function addLedger(e: {
  customerId: number;
  type: LedgerType;
  amount: number;
  shipmentId?: number | null;
  adjustmentId?: number | null;
  note?: string | null;
  createdBy?: string | null;
}): number {
  const r = db()
    .prepare(
      "INSERT INTO ledger (customer_id, type, amount, shipment_id, adjustment_id, note, created_by) VALUES (?,?,?,?,?,?,?)",
    )
    .run(e.customerId, e.type, round2(e.amount), e.shipmentId ?? null, e.adjustmentId ?? null, e.note ?? null, e.createdBy ?? null);
  return Number(r.lastInsertRowid);
}

export class InsufficientBalanceError extends Error {
  constructor(public balance: number, public needed: number, public creditLimit: number) {
    super(
      `余额不足：当前余额 ${balance.toFixed(2)}${creditLimit ? `（信用额度 ${creditLimit.toFixed(2)}）` : ""}，本单需要 ${needed.toFixed(2)}，请先充值`,
    );
  }
}

/** 可用额度 = 余额 + 信用额度 */
export function availableOf(customerId: number): number {
  const c = getCustomer(customerId);
  return round2(balanceOf(customerId) + (c?.creditLimit ?? 0));
}

/** 检查额度够不够（不扣款） */
export function assertCanAfford(customerId: number, amount: number) {
  const c = getCustomer(customerId);
  const bal = balanceOf(customerId);
  if (bal - amount < -(c?.creditLimit ?? 0) - 1e-9) throw new InsufficientBalanceError(bal, amount, c?.creditLimit ?? 0);
}

/** 出单扣款：检查额度并扣款在同一个事务里完成，防止并发超扣 */
export function chargeLabel(customerId: number, shipmentId: number, price: number, createdBy: string) {
  db().transaction(() => {
    assertCanAfford(customerId, price);
    addLedger({ customerId, type: "label", amount: -price, shipmentId, createdBy });
  })();
}

/** ShipBest 拒单时撤销扣款 */
export function removeShipmentLedger(shipmentId: number) {
  db().prepare("DELETE FROM ledger WHERE shipment_id = ?").run(shipmentId);
}

/** 取消退款（幂等：同一张单只退一次） */
export function refundCancelled(customerId: number, shipmentId: number, refund: number, createdBy: string) {
  const exists = db().prepare("SELECT 1 FROM ledger WHERE shipment_id = ? AND type = 'refund'").get(shipmentId);
  if (exists || !(refund > 0)) return;
  addLedger({ customerId, type: "refund", amount: refund, shipmentId, note: "取消订单退款", createdBy });
}

/** 补差入账（幂等）：客户补收记为扣款，退还记为入账 */
export function postAdjustment(adjustmentId: number, customerId: number, shipmentId: number, customerAmount: number, note: string | null) {
  if (!customerAmount) return;
  const exists = db().prepare("SELECT 1 FROM ledger WHERE adjustment_id = ?").get(adjustmentId);
  if (exists) return;
  addLedger({ customerId, type: "adjustment", amount: -customerAmount, shipmentId, adjustmentId, note, createdBy: "system" });
}

interface LedgerRow {
  id: number;
  customer_id: number;
  customer_name?: string;
  type: LedgerType;
  amount: number;
  shipment_id: number | null;
  custom_no?: string | null;
  tracking_no?: string | null;
  adjustment_id: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export function listLedger(f: { customerId?: number; from?: string; to?: string; limit?: number }): LedgerEntry[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.customerId) {
    where.push("l.customer_id = ?");
    args.push(f.customerId);
  }
  if (f.from) {
    where.push("date(l.created_at, 'localtime') >= ?");
    args.push(f.from);
  }
  if (f.to) {
    where.push("date(l.created_at, 'localtime') <= ?");
    args.push(f.to);
  }
  const rows = db()
    .prepare(
      `SELECT l.*, c.name AS customer_name, s.custom_no, s.tracking_no FROM ledger l
       JOIN customers c ON c.id = l.customer_id LEFT JOIN shipments s ON s.id = l.shipment_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY l.id DESC ${f.limit ? `LIMIT ${Number(f.limit)}` : ""}`,
    )
    .all(...args) as LedgerRow[];

  // 按客户查询时计算每笔之后的余额
  let running: number | null = null;
  if (f.customerId) {
    const lastId = rows[0]?.id ?? 0;
    const r = db()
      .prepare("SELECT COALESCE(SUM(amount), 0) AS b FROM ledger WHERE customer_id = ? AND id <= ?")
      .get(f.customerId, lastId) as { b: number };
    running = r.b;
  }
  return rows.map((r) => {
    const e: LedgerEntry = {
      id: r.id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      type: r.type,
      amount: r.amount,
      shipmentId: r.shipment_id,
      customNo: r.custom_no,
      trackingNo: r.tracking_no,
      adjustmentId: r.adjustment_id,
      note: r.note,
      createdBy: r.created_by,
      createdAt: r.created_at,
    };
    if (running !== null) {
      e.balanceAfter = round2(running);
      running -= r.amount;
    }
    return e;
  });
}
