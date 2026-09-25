import { fmtTime, TZ_LABEL } from "@/lib/time";
import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { getCustomer, STATUS_LABEL, type ShipmentStatus } from "@/lib/db";
import { listOrderCharges } from "@/lib/ledger";
import { getLang, getT } from "@/lib/prefs";

/** 表头首字母大写（中文不受影响） */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** 按订单扣款明细 CSV。后台可以导出任意客户；客户只能导出自己的。 */
export async function GET(req: Request) {
  const tr = await getT();
  const en = (await getLang()) === "en";
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
    tr("扣款明细-{name}-{from}_{to}.csv", { name: c.name, from: from ?? (en ? "start" : "开始"), to: to ?? (en ? "now" : "至今") }),
    [tr("下单时间({tz})", { tz: tr(TZ_LABEL) }), ...["我的订单号", "系统单号", "运单号", "渠道", "状态", "运费", "补差", "取消退款", "实际扣款"].map((h) => cap(tr(h)))],
    [
      ...rows.map((r) => [fmtTime(r.createdAt), r.customerRef, r.customNo, r.trackingNo, r.channelName, tr(STATUS_LABEL[r.status as ShipmentStatus] ?? r.status),
        r.freight.toFixed(2), r.adjustment.toFixed(2), r.refund.toFixed(2), r.net.toFixed(2)]),
      [],
      [tr("合计"), tr("{n} 单", { n: rows.length }), "", "", "", "", t("freight"), t("adjustment"), t("refund"), t("net")],
    ],
  );
}
