import { fmtTime } from "./time";
import { getCustomer, listAdjustments, listShipments, STATUS_LABEL } from "./db";

export interface StatementLine {
  date: string;
  type: "面单" | "取消" | "补差";
  ref: string;
  customerRef: string;
  trackingNo: string;
  detail: string;
  amount: number;
  shipmentId: number | null;
}

/**
 * 客户对账单：
 * - 期间内创建的面单：客户价（已取消的只收取消手续费）
 * - 期间内导入的官方账单补差（补差可能是之前月份的单）
 */
export function buildStatement(customerId: number, from?: string, to?: string) {
  const customer = getCustomer(customerId);
  if (!customer) return null;
  const lines: StatementLine[] = [];
  for (const s of listShipments({ customerId, from, to })) {
    if (s.status === "exception") continue;
    const cancelled = s.status === "cancelled";
    lines.push({
      date: fmtTime(s.createdAt),
      type: cancelled ? "取消" : "面单",
      ref: s.customNo,
      customerRef: s.customerRef ?? "",
      trackingNo: s.trackingNo ?? "",
      detail: `${s.channelName ?? ""} · ${s.recipient.city} ${s.recipient.zipCode}${s.status !== "labeled" ? ` · ${STATUS_LABEL[s.status]}` : ""}${cancelled ? `（原价 ${s.price.toFixed(2)}，已退 ${(s.refundAmount ?? 0).toFixed(2)}）` : ""}`,
      amount: cancelled ? s.cancelFee ?? 0 : s.price,
      shipmentId: s.id,
    });
  }
  for (const a of listAdjustments({ customerId, from, to })) {
    if (!a.shipmentId || a.customerAmount === 0) continue;
    lines.push({
      date: fmtTime(a.createdAt),
      type: "补差",
      ref: a.customNo ?? a.matchKey,
      customerRef: "",
      trackingNo: a.trackingNo ?? "",
      detail: `${a.customerAmount > 0 ? "补收" : "退还"}${a.reason ? ` · ${a.reason}` : ""}`,
      amount: a.customerAmount,
      shipmentId: a.shipmentId,
    });
  }
  lines.sort((a, b) => a.date.localeCompare(b.date));
  const sum = (t: StatementLine["type"]) => lines.filter((l) => l.type === t).reduce((x, l) => x + l.amount, 0);
  return {
    customer,
    lines,
    totals: { labels: sum("面单"), cancels: sum("取消"), adjustments: sum("补差"), total: lines.reduce((x, l) => x + l.amount, 0) },
  };
}
