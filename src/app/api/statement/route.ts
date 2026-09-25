import { TZ_LABEL } from "@/lib/time";
import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { buildStatement } from "@/lib/statement";
import { balanceAt, balanceOf, topupsBetween } from "@/lib/ledger";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  let customerId = Number(p.get("customerId"));
  const admin = await isLoggedIn();
  // 客户只能下载自己的对账单
  if (!admin) {
    const own = await currentCustomerId();
    if (!own) return new Response("Unauthorized", { status: 401 });
    customerId = own;
  }
  const from = p.get("from") || undefined;
  const to = p.get("to") || undefined;
  const st = buildStatement(customerId, from, to);
  if (!st) return new Response("客户不存在", { status: 404 });
  const rows: unknown[][] = st.lines.map((l) => [l.date, l.type, l.customerRef, l.ref, l.trackingNo, l.detail, l.amount.toFixed(2)]);
  const opening = from ? balanceAt(customerId, { before: from }) : 0;
  const closing = to ? balanceAt(customerId, { through: to }) : balanceOf(customerId);
  const sumRow = (label: string, v: number) => ["", "", "", "", "", label, v.toFixed(2)];
  rows.push(
    [],
    sumRow("面单合计", st.totals.labels),
    sumRow("取消手续费合计", st.totals.cancels),
    sumRow("补差合计", st.totals.adjustments),
    sumRow(admin ? "应收合计" : "本期应付合计", st.totals.total),
    [],
    sumRow("期初余额", opening),
    sumRow("本期充值", topupsBetween(customerId, from, to)),
    sumRow("期末余额", closing),
  );
  return csvResponse(
    `对账单-${st.customer.name}-${from ?? "开始"}_${to ?? "至今"}.csv`,
    [`日期(${TZ_LABEL})`, "类型", admin ? "客户订单号" : "我的订单号", "系统单号", "运单号", "说明", "金额"],
    rows,
  );
}
