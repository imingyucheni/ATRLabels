import { fmtTime, TZ_LABEL } from "@/lib/time";
import { isLoggedIn } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { listShipments, shipmentProfit, STATUS_LABEL } from "@/lib/db";

export async function GET(req: Request) {
  if (!(await isLoggedIn())) return new Response("Unauthorized", { status: 401 });
  const p = new URL(req.url).searchParams;
  const rows = listShipments({
    customerId: Number(p.get("customerId")) || undefined,
    status: p.get("status") || undefined,
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
    q: p.get("q") || undefined,
  });
  const header = [
    `创建时间(${TZ_LABEL})`, "客户", "自定义单号", "ShipBest单号", "运单号", "渠道", "状态",
    "收件人", "收件国家", "收件邮编", "分区", "币种", "试算成本", "实扣成本(预报)", "客户价",
    "取消手续费", "ShipBest取消费", "退款", "补差成本", "补差向客户", "利润",
  ];
  return csvResponse(
    `shipments-${new Date().toISOString().slice(0, 10)}.csv`,
    header,
    rows.map((s) => [
      fmtTime(s.createdAt), s.customerName, s.customNo, s.orderNo, s.trackingNo, s.channelName, STATUS_LABEL[s.status],
      `${s.recipient.nameFirst} ${s.recipient.nameLast}`, s.recipient.country, s.recipient.zipCode, s.zone, s.currency,
      s.quotedCost, s.actualCost, s.price, s.cancelFee, s.sbCancelFee, s.refundAmount,
      s.costAdj || "", s.customerAdj || "", shipmentProfit(s)?.toFixed(2),
    ]),
  );
}
