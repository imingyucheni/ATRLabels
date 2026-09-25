import { currentCustomerId } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { STATUS_LABEL } from "@/lib/db";
import { listOwnShipments } from "@/lib/portal";

/** 客户导出自己的面单（不含成本） */
export async function GET(req: Request) {
  const me = await currentCustomerId();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const p = new URL(req.url).searchParams;
  const rows = listOwnShipments(me, { status: p.get("status") || undefined, from: p.get("from") || undefined, to: p.get("to") || undefined, q: p.get("q") || undefined });
  return csvResponse(
    `面单-${new Date().toISOString().slice(0, 10)}.csv`,
    ["下单时间(UTC)", "我的订单号", "系统单号", "运单号", "渠道", "分区", "状态", "收件人", "城市", "州", "邮编", "国家", "币种", "运费", "取消手续费", "退回", "补差"],
    rows.map((s) => [
      s.createdAt, s.customerRef, s.customNo, s.trackingNo, s.channelName, s.zone, STATUS_LABEL[s.status],
      `${s.recipient.nameFirst} ${s.recipient.nameLast}`, s.recipient.city, s.recipient.province, s.recipient.zipCode, s.recipient.country,
      s.currency, s.price, s.cancelFee, s.refundAmount, s.adjustment || "",
    ]),
  );
}
