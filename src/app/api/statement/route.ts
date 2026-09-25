import { isLoggedIn } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { buildStatement } from "@/lib/statement";

export async function GET(req: Request) {
  if (!(await isLoggedIn())) return new Response("Unauthorized", { status: 401 });
  const p = new URL(req.url).searchParams;
  const from = p.get("from") || undefined;
  const to = p.get("to") || undefined;
  const st = buildStatement(Number(p.get("customerId")), from, to);
  if (!st) return new Response("客户不存在", { status: 404 });
  const rows: unknown[][] = st.lines.map((l) => [l.date, l.type, l.ref, l.trackingNo, l.detail, l.amount.toFixed(2)]);
  rows.push([], ["", "", "", "", "面单合计", st.totals.labels.toFixed(2)], ["", "", "", "", "取消手续费合计", st.totals.cancels.toFixed(2)],
    ["", "", "", "", "补差合计", st.totals.adjustments.toFixed(2)], ["", "", "", "", "应收合计", st.totals.total.toFixed(2)]);
  return csvResponse(`对账单-${st.customer.name}-${from ?? "开始"}_${to ?? "至今"}.csv`, ["日期(UTC)", "类型", "单号", "运单号", "说明", "金额"], rows);
}
