import { db, getCustomer, getSettings } from "./db";
import { checkLowBalanceSoon, notifyLater, queueAdjustmentNotice } from "./notify";

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

/** 某天开始前（不含）/ 某天结束时（含）的余额；日期按服务器本地时间 */
export function balanceAt(customerId: number, opts: { before?: string; through?: string }): number {
  const where = opts.before ? "AND date(created_at, 'localtime') < ?" : opts.through ? "AND date(created_at, 'localtime') <= ?" : "";
  const args = opts.before ? [opts.before] : opts.through ? [opts.through] : [];
  const r = db().prepare(`SELECT COALESCE(SUM(amount), 0) AS b FROM ledger WHERE customer_id = ? ${where}`).get(customerId, ...args) as { b: number };
  return round2(r.b);
}

/** 期间内的充值合计 */
export function topupsBetween(customerId: number, from?: string, to?: string): number {
  const r = db()
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS b FROM ledger WHERE customer_id = ? AND type = 'topup'
       ${from ? "AND date(created_at, 'localtime') >= @from" : ""} ${to ? "AND date(created_at, 'localtime') <= @to" : ""}`,
    )
    .get(customerId, ...(from || to ? [{ from, to }] : [])) as { b: number };
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
  // 余额变了：几秒后检查是否要发“余额不足”提醒
  checkLowBalanceSoon(e.customerId);
  return Number(r.lastInsertRowid);
}

export class InsufficientBalanceError extends Error {
  constructor(public balance: number, public needed: number, public creditLimit: number, rule: BalanceRule = "cover") {
    const credit = creditLimit ? `（信用额度 ${creditLimit.toFixed(2)}）` : "";
    super(
      rule === "positive"
        ? `余额不足：当前余额 ${balance.toFixed(2)}${credit}，需要先充值才能继续下单`
        : `余额不足：当前余额 ${balance.toFixed(2)}${credit}，本单需要 ${needed.toFixed(2)}，请先充值`,
    );
  }
}

/**
 * 下单余额规则：
 * positive：余额（含信用额度）大于 0 就可以下单，这一单可以让余额变成负数；余额 ≤ 0 时必须充值
 * cover：余额（含信用额度）必须够付这一单
 */
export type BalanceRule = "positive" | "cover";

export const BALANCE_RULE_LABEL: Record<BalanceRule, string> = {
  positive: "余额大于 0 即可下单（这一单可以让余额变负，余额 ≤ 0 时必须充值）",
  cover: "余额必须够付这一单才能下单",
};

/** 按规则判断能否下单 */
export function canAfford(balance: number, creditLimit: number, amount: number, rule: BalanceRule): boolean {
  if (rule === "positive") return balance + creditLimit > 1e-9;
  return balance - amount >= -creditLimit - 1e-9;
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
  const rule = getSettings().balanceRule;
  const limit = c?.creditLimit ?? 0;
  if (!canAfford(bal, limit, amount, rule)) throw new InsufficientBalanceError(bal, amount, limit, rule);
}

/** 出单扣款：检查额度并扣款在同一个事务里完成，防止并发超扣 */
export function chargeLabel(customerId: number, shipmentId: number, price: number, createdBy: string, note?: string) {
  db().transaction(() => {
    assertCanAfford(customerId, price);
    addLedger({ customerId, type: "label", amount: -price, shipmentId, createdBy, note: note ?? null });
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
  const s = db().prepare("SELECT custom_no, customer_ref, cancel_fee FROM shipments WHERE id = ?").get(shipmentId) as { custom_no: string; customer_ref: string | null; cancel_fee: number | null } | undefined;
  const ref = s?.customer_ref || s?.custom_no || String(shipmentId);
  const fee = s?.cancel_fee ? ` (fee $${s.cancel_fee.toFixed(2)})` : "";
  notifyLater(customerId, "cancel", { zh: `订单 ${ref} 已取消`, en: `Order ${ref} cancelled` }, {
    zh: [`订单 ${ref} 已取消，$${refund.toFixed(2)} 已退回账户余额${s?.cancel_fee ? `（扣除取消手续费 $${s.cancel_fee.toFixed(2)}）` : ""}。这张面单已作废，请不要再使用。`],
    en: [`Order ${ref} has been cancelled and $${refund.toFixed(2)} was refunded to your balance${fee}. The label is void — please don't use it.`],
  });
}

/** 补差入账（幂等）：客户补收记为扣款，退还记为入账 */
export function postAdjustment(adjustmentId: number, customerId: number, shipmentId: number, customerAmount: number, note: string | null) {
  if (!customerAmount) return;
  const exists = db().prepare("SELECT 1 FROM ledger WHERE adjustment_id = ?").get(adjustmentId);
  if (exists) return;
  addLedger({ customerId, type: "adjustment", amount: -customerAmount, shipmentId, adjustmentId, note, createdBy: "system" });
  const s = db().prepare("SELECT custom_no, customer_ref, tracking_no FROM shipments WHERE id = ?").get(shipmentId) as { custom_no: string; customer_ref: string | null; tracking_no: string | null } | undefined;
  queueAdjustmentNotice(customerId, s?.customer_ref || s?.tracking_no || s?.custom_no || String(shipmentId), customerAmount, note);
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

export function listLedger(f: { customerId?: number; shipmentId?: number; from?: string; to?: string; limit?: number }): LedgerEntry[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.shipmentId) {
    where.push("l.shipment_id = ?");
    args.push(f.shipmentId);
  }
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
  if (f.customerId && !f.shipmentId) {
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

/* ---------------- 按订单汇总扣款 ---------------- */

export interface OrderCharge {
  shipmentId: number;
  customNo: string;
  customerRef: string | null;
  trackingNo: string | null;
  channelName: string | null;
  status: string;
  createdAt: string;
  /** 运费扣款（正数） */
  freight: number;
  /** 账单补差：正数 = 补收，负数 = 退还 */
  adjustment: number;
  /** 取消退款（正数） */
  refund: number;
  /** 这一单实际扣款合计 = 运费 + 补差 - 退款 */
  net: number;
}

/** 每一单的扣款明细（按下单时间筛选） */
export function listOrderCharges(customerId: number, f: { from?: string; to?: string; q?: string } = {}): OrderCharge[] {
  const where = ["l.customer_id = ?"];
  const args: (string | number)[] = [customerId];
  if (f.from) {
    where.push("date(s.created_at, 'localtime') >= ?");
    args.push(f.from);
  }
  if (f.to) {
    where.push("date(s.created_at, 'localtime') <= ?");
    args.push(f.to);
  }
  if (f.q) {
    where.push("(s.custom_no LIKE ? OR s.tracking_no LIKE ? OR s.customer_ref LIKE ?)");
    args.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
  }
  const rows = db()
    .prepare(
      `SELECT s.id, s.custom_no, s.customer_ref, s.tracking_no, s.channel_name, s.status, s.created_at,
        COALESCE(SUM(CASE WHEN l.type = 'label' THEN l.amount END), 0) AS freight,
        COALESCE(SUM(CASE WHEN l.type = 'adjustment' THEN l.amount END), 0) AS adj,
        COALESCE(SUM(CASE WHEN l.type = 'refund' THEN l.amount END), 0) AS refund,
        SUM(l.amount) AS net
       FROM ledger l JOIN shipments s ON s.id = l.shipment_id
       WHERE ${where.join(" AND ")} GROUP BY s.id ORDER BY s.id DESC`,
    )
    .all(...args) as {
    id: number; custom_no: string; customer_ref: string | null; tracking_no: string | null; channel_name: string | null;
    status: string; created_at: string; freight: number; adj: number; refund: number; net: number;
  }[];
  return rows.map((r) => ({
    shipmentId: r.id,
    customNo: r.custom_no,
    customerRef: r.customer_ref,
    trackingNo: r.tracking_no,
    channelName: r.channel_name,
    status: r.status,
    createdAt: r.created_at,
    freight: round2(-r.freight),
    adjustment: round2(-r.adj),
    refund: round2(r.refund),
    net: round2(-r.net),
  }));
}
