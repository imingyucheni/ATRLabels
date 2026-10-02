import { TZ_LABEL } from "@/lib/time";
import { currentAdmin, currentCustomerId } from "@/lib/auth";
import { customerAccess } from "@/lib/adminSession";
import { csvResponse } from "@/lib/csv";
import { buildStatement } from "@/lib/statement";
import { balanceAt, balanceOf, topupsBetween } from "@/lib/ledger";
import { getLang, getT } from "@/lib/prefs";
import { translateMessage } from "@/lib/i18n";

/** 表头首字母大写（中文不受影响） */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function GET(req: Request) {
  const t = await getT();
  const lang = await getLang();
  const en = lang === "en";
  // 说明是“渠道 · 城市 邮编 · 状态”这样拼起来的，逐段翻译（中文原样）
  const detail = (s: string) => s.split(" · ").map((x) => translateMessage(lang, x)).join(" · ");
  const p = new URL(req.url).searchParams;
  let customerId = Number(p.get("customerId"));
  const who = await currentAdmin();
  // 客户只能下载自己的对账单；员工只能下载授权给他的客户
  if (!who) {
    const own = await currentCustomerId();
    if (!own) return new Response("Unauthorized", { status: 401 });
    customerId = own;
  } else if (!customerAccess(who, customerId)) return new Response("Not found", { status: 404 });
  const admin = !!who;
  const from = p.get("from") || undefined;
  const to = p.get("to") || undefined;
  const st = buildStatement(customerId, from, to);
  if (!st) return new Response(t("客户不存在"), { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const rows: unknown[][] = st.lines.map((l) => [l.date, en && l.type === "取消" ? "Cancellation" : t(l.type), l.customerRef, l.ref, l.trackingNo, detail(l.detail), l.amount.toFixed(2)]);
  const opening = from ? balanceAt(customerId, { before: from }) : 0;
  const closing = to ? balanceAt(customerId, { through: to }) : balanceOf(customerId);
  const sumRow = (label: string, v: number) => ["", "", "", "", "", t(label), v.toFixed(2)];
  const topups = topupsBetween(customerId, from, to);
  // 让“期初 + 充值 − 本期费用 = 期末”对得上：手动调账、之前月份的单在本期取消退款等，单独列一行
  const other = Math.round((closing - opening - topups + st.totals.total) * 100) / 100;
  rows.push(
    [],
    sumRow("面单合计", st.totals.labels),
    sumRow("取消手续费合计", st.totals.cancels),
    sumRow("补差合计", st.totals.adjustments),
    sumRow(admin ? "应收合计" : "本期应付合计", st.totals.total),
    [],
    sumRow("期初余额", opening),
    sumRow("本期充值", topups),
    ...(Math.abs(other) >= 0.01 ? [sumRow("其他调整（手动调账、跨期取消退款等）", other)] : []),
    sumRow("期末余额", closing),
  );
  return csvResponse(
    t("对账单-{name}-{from}_{to}.csv", { name: st.customer.name, from: from ?? (en ? "start" : "开始"), to: to ?? (en ? "now" : "至今") }),
    [t("日期({tz})", { tz: t(TZ_LABEL) }), ...["类型", admin ? "客户订单号" : "我的订单号", "系统单号", "运单号", "说明", "金额"].map((h) => cap(t(h)))],
    rows,
  );
}
