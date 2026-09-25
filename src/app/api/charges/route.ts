import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { getCustomer, STATUS_LABEL, type ShipmentStatus } from "@/lib/db";
import { listOrderCharges } from "@/lib/ledger";

/** 按订单扣款明细 CSV。后台可以导出任意客户；客户只能导出自己的。 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  let customerId = Number(p.get("customerId"));
  if (!(await isLoggedIn())) {
    const own = await currentCustomerId();
    if (!own) return new Response("Unauthorized", { status: 401 });
    customerId = own;
  }
  const c = getCustomer(customerId);
  if (!c) return new Response("Not found", { status: 404 });
  const from = p.get("from") || undefined;
  const to = p.get("to") || undefined;
  const rows = listOrderCharges(customerId, { from, to });
  const t = (k: "freight" | "adjustment" | "refund" | "net") => rows.reduce((a, r) => a + r[k], 0).toFixed(2);
  return csvResponse(
    `扣款明细-${c.name}-${from ?? "开始"}_${to ?? "至今"}.csv`,
    ["下单时间(UTC)", "我的订单号", "系统单号", "运单号", "渠道", "状态", "运费", "补差", "取消退款", "实际扣款"],
    [
      ...rows.map((r) => [r.createdAt, r.customerRef, r.customNo, r.trackingNo, r.channelName, STATUS_LABEL[r.status as ShipmentStatus] ?? r.status,
        r.freight.toFixed(2), r.adjustment.toFixed(2), r.refund.toFixed(2), r.net.toFixed(2)]),
      [],
      ["合计", `${rows.length} 单`, "", "", "", "", t("freight"), t("adjustment"), t("refund"), t("net")],
    ],
  );
}
