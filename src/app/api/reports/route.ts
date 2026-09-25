import { isLoggedIn } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { buildReport, localDate } from "@/lib/reports";
import { getLang, getT } from "@/lib/prefs";

/** 表头首字母大写（中文不受影响） */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function GET(req: Request) {
  if (!(await isLoggedIn())) return new Response("Unauthorized", { status: 401 });
  const t = await getT();
  const en = (await getLang()) === "en";
  // “取消”在这里是取消的单数，英文用 Cancelled
  const h = (k: string) => (en && k === "取消" ? "Cancelled" : cap(t(k)));
  const p = new URL(req.url).searchParams;
  const to = p.get("to") || localDate();
  const from = p.get("from") || to;
  const r = buildReport(from, to, Number(p.get("customerId")) || undefined);
  const m = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + "%" : "");
  const type = p.get("type");
  if (type === "channel") {
    return csvResponse(t("渠道-{from}_{to}.csv", { from, to }), ["渠道", "订单", "占比", "客户消费", "成本", "利润", "利润率"].map(h),
      r.channels.map((c) => [c.name, c.orders, (c.share * 100).toFixed(1) + "%", c.revenue, c.cost, c.profit, m(c.profit, c.revenue)]));
  }
  if (type === "customer") {
    return csvResponse(t("客户-{from}_{to}.csv", { from, to }), ["客户", "订单", "取消", "客户消费", "成本", "利润", "利润率", "当前余额"].map(h),
      r.customers.map((c) => [c.name, c.orders, c.cancelled, c.revenue, c.cost, c.profit, m(c.profit, c.revenue), c.balance]));
  }
  return csvResponse(t("每日-{from}_{to}.csv", { from, to }), ["日期", "订单", "取消", "客户消费", "成本", "利润", "利润率"].map(h),
    r.daily.map((d) => [d.date, d.orders, d.cancelled, d.revenue, d.cost, d.profit, m(d.profit, d.revenue)]));
}
