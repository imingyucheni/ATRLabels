import { isLoggedIn } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { buildReport, localDate } from "@/lib/reports";

export async function GET(req: Request) {
  if (!(await isLoggedIn())) return new Response("Unauthorized", { status: 401 });
  const p = new URL(req.url).searchParams;
  const to = p.get("to") || localDate();
  const from = p.get("from") || to;
  const r = buildReport(from, to, Number(p.get("customerId")) || undefined);
  const m = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + "%" : "");
  const type = p.get("type");
  if (type === "channel") {
    return csvResponse(`渠道-${from}_${to}.csv`, ["渠道", "订单", "占比", "客户消费", "成本", "利润", "利润率"],
      r.channels.map((c) => [c.name, c.orders, (c.share * 100).toFixed(1) + "%", c.revenue, c.cost, c.profit, m(c.profit, c.revenue)]));
  }
  if (type === "customer") {
    return csvResponse(`客户-${from}_${to}.csv`, ["客户", "订单", "取消", "客户消费", "成本", "利润", "利润率", "当前余额"],
      r.customers.map((c) => [c.name, c.orders, c.cancelled, c.revenue, c.cost, c.profit, m(c.profit, c.revenue), c.balance]));
  }
  return csvResponse(`每日-${from}_${to}.csv`, ["日期", "订单", "取消", "客户消费", "成本", "利润", "利润率"],
    r.daily.map((d) => [d.date, d.orders, d.cancelled, d.revenue, d.cost, d.profit, m(d.profit, d.revenue)]));
}
