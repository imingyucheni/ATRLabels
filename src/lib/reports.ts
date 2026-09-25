/**
 * 后台报表：按天 / 渠道 / 客户统计订单数、客户消费（收入）、成本、利润。
 * 收入 = 客户价（取消的只算取消手续费）+ 向客户补收的补差；成本 = ShipBest 扣费 + ShipBest 补差 / 取消费。
 * 按下单日期归属（补差也算在原订单的下单日期上，方便看每一单的真实利润）。
 */
import { db, getCustomer, listShipments, shipmentCost, shipmentProfit, shipmentReceivable, type Shipment } from "./db";

export interface Totals {
  orders: number;
  cancelled: number;
  revenue: number;
  cost: number;
  profit: number;
}

export interface DayRow extends Totals {
  date: string;
}

export interface ChannelRow extends Totals {
  code: string;
  name: string;
  share: number;
}

export interface CustomerRow extends Totals {
  id: number;
  name: string;
  balance: number;
}

const empty = (): Totals => ({ orders: 0, cancelled: 0, revenue: 0, cost: 0, profit: 0 });
const r2 = (n: number) => Math.round(n * 100) / 100;

/** 服务器本地日期 yyyy-mm-dd */
export function localDate(d: Date = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shipmentDate(s: Shipment) {
  return localDate(new Date(s.createdAt.replace(" ", "T") + "Z"));
}

function add(t: Totals, s: Shipment) {
  if (s.status === "exception") return;
  if (s.status === "cancelled") t.cancelled++;
  else t.orders++;
  t.revenue += shipmentReceivable(s);
  t.cost += shipmentCost(s);
  t.profit += shipmentProfit(s) ?? 0;
}

function round<T extends Totals>(t: T): T {
  return { ...t, revenue: r2(t.revenue), cost: r2(t.cost), profit: r2(t.profit) };
}

function days(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while (d <= end && out.length < 400) {
    out.push(localDate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function shiftRange(from: string, to: string) {
  const n = days(from, to).length;
  const f = new Date(from + "T00:00:00");
  f.setDate(f.getDate() - n);
  const t = new Date(from + "T00:00:00");
  t.setDate(t.getDate() - 1);
  return { from: localDate(f), to: localDate(t) };
}

export interface Report {
  from: string;
  to: string;
  customerId?: number;
  totals: Totals;
  previous: Totals;
  topups: number;
  daily: DayRow[];
  channels: ChannelRow[];
  customers: CustomerRow[];
}

export function buildReport(from: string, to: string, customerId?: number): Report {
  const list = listShipments({ from, to, customerId });
  const prevRange = shiftRange(from, to);
  const prev = listShipments({ ...prevRange, customerId });

  const totals = empty();
  const previous = empty();
  const byDay = new Map(days(from, to).map((d) => [d, { date: d, ...empty() } as DayRow]));
  const byChannel = new Map<string, ChannelRow>();
  const byCustomer = new Map<number, CustomerRow>();

  for (const s of list) {
    add(totals, s);
    const d = byDay.get(shipmentDate(s));
    if (d) add(d, s);
    const ch = byChannel.get(s.channelCode) ?? { code: s.channelCode, name: s.channelName ?? s.channelCode, share: 0, ...empty() };
    add(ch, s);
    byChannel.set(s.channelCode, ch);
    const cu = byCustomer.get(s.customerId) ?? { id: s.customerId, name: s.customerName ?? "", balance: 0, ...empty() };
    add(cu, s);
    byCustomer.set(s.customerId, cu);
  }
  for (const s of prev) add(previous, s);

  const channels = [...byChannel.values()]
    .map((c) => round({ ...c, share: totals.orders ? c.orders / totals.orders : 0 }))
    .sort((a, b) => b.orders - a.orders);
  const customers = [...byCustomer.values()]
    .map((c) => round({ ...c, balance: getCustomer(c.id)?.balance ?? 0 }))
    .sort((a, b) => b.revenue - a.revenue);

  const topups = (
    db()
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS s FROM ledger WHERE type = 'topup'
         AND date(created_at, 'localtime') BETWEEN ? AND ? ${customerId ? "AND customer_id = ?" : ""}`,
      )
      .get(from, to, ...(customerId ? [customerId] : [])) as { s: number }
  ).s;

  return {
    from,
    to,
    customerId,
    totals: round(totals),
    previous: round(previous),
    topups: r2(topups),
    daily: [...byDay.values()].map(round),
    channels,
    customers,
  };
}

/** 常用时间范围 */
export function presetRanges() {
  const today = new Date();
  const d = (offset: number) => {
    const x = new Date(today);
    x.setDate(x.getDate() + offset);
    return localDate(x);
  };
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  return [
    { key: "today", label: "今天", from: d(0), to: d(0) },
    { key: "7d", label: "近 7 天", from: d(-6), to: d(0) },
    { key: "30d", label: "近 30 天", from: d(-29), to: d(0) },
    { key: "month", label: "本月", from: localDate(monthStart), to: d(0) },
    { key: "lastmonth", label: "上月", from: localDate(lastStart), to: localDate(lastEnd) },
  ];
}
