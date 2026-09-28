import { fmtTime, TZ_LABEL } from "@/lib/time";
import { isLoggedIn } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { isInternalCustomer, listShipments, shipmentProfit, STATUS_LABEL } from "@/lib/db";
import { getT } from "@/lib/prefs";
import { isJiaguCode, jgOrders } from "@/lib/shipbest/jiagu";

/** 表头首字母大写（中文不受影响） */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function GET(req: Request) {
  if (!(await isLoggedIn())) return new Response("Unauthorized", { status: 401 });
  const t = await getT();
  const p = new URL(req.url).searchParams;
  const rows = listShipments({
    customerId: Number(p.get("customerId")) || undefined,
    status: p.get("status") || undefined,
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
    q: p.get("q") || undefined,
  });
  // 第一列是客户导入 / 下单时填的“自定义单号”（客户自己的订单号），和客户的导入表格一致；系统单号是我们生成的 ATR 单号
  const base = ["客户", "系统单号", "服务商", "服务商单号", "运单号", "渠道", "状态", "SKU", "收件人", "收件国家", "收件邮编", "分区", "币种"];
  // 全是管理员自用（成本价）的单：成本 = 客户价、没有利润，只留一列运费
  const houseOnly = rows.length > 0 && rows.every((s) => isInternalCustomer(s.customerId));
  const money = houseOnly
    ? ["运费", "取消费", "补差"]
    : ["试算成本", "实扣成本(预报)", "客户价", "取消手续费", "ShipBest取消费", "退款", "补差成本", "补差向客户", "利润"];
  const header = [cap(t("自定义单号")), t("创建时间({tz})", { tz: t(TZ_LABEL) }), ...[...base, ...money].map((h) => cap(t(h)))];
  return csvResponse(
    `shipments-${new Date().toISOString().slice(0, 10)}.csv`,
    header,
    rows.map((s) => [
      s.customerRef ?? "", fmtTime(s.createdAt), s.customerName, s.customNo,
      isJiaguCode(s.channelCode) ? "GDE" : "SB", isJiaguCode(s.channelCode) ? jgOrders.get(s.customNo)?.identifier ?? "" : s.orderNo,
      s.trackingNo, s.channelName, t(STATUS_LABEL[s.status]),
      s.skuList.map((k) => (k.quantity > 1 ? `${k.sku} x${k.quantity}` : k.sku)).filter(Boolean).join("; "),
      `${s.recipient.nameFirst} ${s.recipient.nameLast}`, s.recipient.country, s.recipient.zipCode, s.zone, s.currency,
      ...(houseOnly
        ? [s.status === "cancelled" || s.status === "exception" ? "" : s.actualCost ?? s.quotedCost, s.sbCancelFee || "", s.costAdj || ""]
        : [s.quotedCost, s.actualCost, s.price, s.cancelFee, s.sbCancelFee, s.refundAmount, s.costAdj || "", s.customerAdj || "", shipmentProfit(s)?.toFixed(2)]),
    ]),
  );
}
