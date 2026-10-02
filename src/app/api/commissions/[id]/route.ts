import { isLoggedIn } from "@/lib/auth";
import { commissionLines, getSales } from "@/lib/commission";
import { csvResponse } from "@/lib/csv";
import { getT } from "@/lib/prefs";

/** 销售佣金明细 CSV（发给销售核对用） */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return new Response("Unauthorized", { status: 401 });
  const rep = getSales(Number((await params).id));
  if (!rep) return new Response("Not found", { status: 404 });
  const t = await getT();
  const p = new URL(req.url).searchParams;
  const from = p.get("from") || undefined;
  const to = p.get("to") || undefined;
  const lines = commissionLines({ salesId: rep.id, from, to });
  return csvResponse(
    t("佣金-{name}-{from}-{to}.csv", { name: rep.name, from: from ?? "", to: to ?? "" }),
    ["日期", "单号", "我的订单号", "客户", "渠道", "运单号", "状态", "利润", "比例%", "佣金", "已结", "未结"].map((h) => t(h)),
    lines.map((l) => [
      l.date, l.shipment.customNo, l.shipment.customerRef ?? "", l.shipment.customerName ?? "", l.shipment.channelName ?? l.shipment.channelCode, l.shipment.trackingNo ?? "",
      l.shipment.status, l.profit.toFixed(2), String(l.rate), l.commission.toFixed(2), l.paid.toFixed(2), l.due.toFixed(2),
    ]),
  );
}
