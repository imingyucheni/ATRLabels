/**
 * 服务商对账：按周期统计向每家服务商（ShipBest / 嘉谷）买了多少面单、花了多少邮费，按渠道细分。
 * - 出单和邮费：按下单日期归属（有实扣用实扣，否则用下单时的试算成本）
 * - 取消的单：服务商退回邮费，只算服务商收的取消费
 * - 补差：按导入日期归属（服务商出账单、我们导入的那天），和服务商的账单周期对得上
 * - 出单异常（没出面单）：不计入应付，单独列出，需要和服务商确认有没有扣费
 * 只统计正式单；模拟 / 沙盒测试单不算。
 */
import { currentEnv, db, getChannel, listShipments, type Shipment } from "./db";
import { stripProviderTag } from "./carriers";
import { isJiaguCode } from "./shipbest/jiagu";
import { localDate } from "./reports";

export type ProviderKey = "shipbest" | "jiagu";

export const PROVIDERS: { key: ProviderKey; name: string; tag: string }[] = [
  { key: "shipbest", name: "ShipBest", tag: "SB" },
  { key: "jiagu", name: "嘉谷万邑", tag: "GDE" },
];

export const providerKeyOf = (channelCode: string): ProviderKey => (isJiaguCode(channelCode) ? "jiagu" : "shipbest");

export interface ReconTotals {
  /** 出单数（不含取消、异常） */
  labels: number;
  /** 邮费 */
  postage: number;
  /** 取消的单数 */
  cancelled: number;
  /** 服务商收的取消费 */
  cancelFees: number;
  /** 期间导入的补差（正数 = 服务商补扣，负数 = 退给我们） */
  adjustments: number;
  adjCount: number;
  /** 出单异常：不计入应付 */
  exceptions: number;
  exceptionCost: number;
  /** 应付合计 = 邮费 + 取消费 + 补差 */
  total: number;
  /** 限时活动：服务商应返给我们的返利（按下单成本估算，不计入应付） */
  rebate: number;
}

export interface ReconChannel extends ReconTotals {
  code: string;
  name: string;
}

export interface ReconDay extends ReconTotals {
  date: string;
}

export interface ProviderRecon {
  key: ProviderKey;
  name: string;
  tag: string;
  totals: ReconTotals;
  channels: ReconChannel[];
  daily: ReconDay[];
}

export interface Recon {
  from: string;
  to: string;
  providers: ProviderRecon[];
  grand: ReconTotals;
  /** 期间导入、但没有对应到订单的补差（不知道是哪家服务商的） */
  unmatchedAdj: { count: number; amount: number };
}

const empty = (): ReconTotals => ({ labels: 0, postage: 0, cancelled: 0, cancelFees: 0, adjustments: 0, adjCount: 0, exceptions: 0, exceptionCost: 0, total: 0, rebate: 0 });
const r2 = (n: number) => Math.round(n * 100) / 100;

function finish<T extends ReconTotals>(t: T): T {
  const postage = r2(t.postage);
  const cancelFees = r2(t.cancelFees);
  const adjustments = r2(t.adjustments);
  return { ...t, postage, cancelFees, adjustments, exceptionCost: r2(t.exceptionCost), total: r2(postage + cancelFees + adjustments), rebate: r2(t.rebate) };
}

/** UTC 时间字符串 → 服务器本地日期（和报表、面单记录的日期筛选一致） */
export function localDay(utc: string) {
  return localDate(new Date(utc.includes("T") ? utc : utc.replace(" ", "T") + "Z"));
}

/** 这张单向服务商付了多少邮费（有实扣用实扣） */
export const postageOf = (s: Shipment) => s.actualCost ?? s.quotedCost;

function addShipment(t: ReconTotals, s: Shipment) {
  if (s.status === "exception") {
    t.exceptions++;
    t.exceptionCost += postageOf(s);
  } else if (s.status === "cancelled") {
    t.cancelled++;
    t.cancelFees += s.sbCancelFee ?? 0;
  } else {
    t.labels++;
    t.postage += postageOf(s);
    if (s.rule?.rebate) t.rebate += (postageOf(s) * s.rule.rebate) / 100;
  }
}

function addAdjustment(t: ReconTotals, amount: number) {
  t.adjCount++;
  t.adjustments += amount;
}

/** 正式环境只算正式单；测试环境里全是测试数据，照常统计（页面顶部有测试环境提示） */
const counts = (s: { isTest: boolean }) => currentEnv() === "test" || !s.isTest;

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

export interface ReconAdjustment {
  id: number;
  createdAt: string;
  batchFilename: string;
  channelCode: string | null;
  channelName: string | null;
  customNo: string | null;
  customerRef: string | null;
  trackingNo: string | null;
  matchKey: string;
  amount: number;
  reason: string | null;
}

/** 期间内导入的补差（按导入日期），带上对应订单的渠道 */
export function reconAdjustments(from: string, to: string): ReconAdjustment[] {
  const rows = db()
    .prepare(
      `SELECT a.id, a.created_at, a.match_key, a.cost_amount, a.reason, b.filename,
              s.channel_code, s.channel_name, s.custom_no, s.customer_ref, s.tracking_no, s.env, s.label_url
       FROM adjustments a JOIN adjustment_batches b ON b.id = a.batch_id
       LEFT JOIN shipments s ON s.id = a.shipment_id
       WHERE date(a.created_at, 'localtime') BETWEEN ? AND ? ORDER BY a.id`,
    )
    .all(from, to) as {
    id: number; created_at: string; match_key: string; cost_amount: number; reason: string | null; filename: string;
    channel_code: string | null; channel_name: string | null; custom_no: string | null; customer_ref: string | null; tracking_no: string | null; env: string | null; label_url: string | null;
  }[];
  return rows
    .filter((r) => !r.channel_code || counts({ isTest: r.env ? r.env !== "live" : !!r.label_url?.startsWith("mock://") }))
    .map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      batchFilename: r.filename,
      channelCode: r.channel_code,
      channelName: r.channel_name,
      customNo: r.custom_no,
      customerRef: r.customer_ref,
      trackingNo: r.tracking_no,
      matchKey: r.match_key,
      amount: r.cost_amount,
      reason: r.reason,
    }));
}

/** 期间内下单的正式单（对账明细用） */
export function reconShipments(from: string, to: string, provider?: ProviderKey): Shipment[] {
  return listShipments({ from, to })
    .filter(counts)
    .filter((s) => !provider || providerKeyOf(s.channelCode) === provider)
    .reverse(); // 按下单时间从早到晚
}

/** 后台显示的渠道名（不带“· SB / · GDE”，已经按服务商分组了） */
export function reconChannelName(code: string, fallback?: string | null) {
  return stripProviderTag(getChannel(code)?.name ?? fallback ?? code);
}

export function buildRecon(from: string, to: string): Recon {
  const dayList = days(from, to);
  const per = new Map<ProviderKey, { totals: ReconTotals; channels: Map<string, ReconChannel>; daily: Map<string, ReconDay> }>();
  const bucket = (key: ProviderKey) => {
    let b = per.get(key);
    if (!b) {
      b = { totals: empty(), channels: new Map(), daily: new Map(dayList.map((d) => [d, { date: d, ...empty() }])) };
      per.set(key, b);
    }
    return b;
  };
  const channelOf = (b: ReturnType<typeof bucket>, code: string, name?: string | null) => {
    let c = b.channels.get(code);
    if (!c) {
      c = { code, name: reconChannelName(code, name), ...empty() };
      b.channels.set(code, c);
    }
    return c;
  };

  for (const s of reconShipments(from, to)) {
    const b = bucket(providerKeyOf(s.channelCode));
    addShipment(b.totals, s);
    addShipment(channelOf(b, s.channelCode, s.channelName), s);
    const d = b.daily.get(localDay(s.createdAt));
    if (d) addShipment(d, s);
  }

  const unmatchedAdj = { count: 0, amount: 0 };
  for (const a of reconAdjustments(from, to)) {
    if (!a.channelCode) {
      unmatchedAdj.count++;
      unmatchedAdj.amount += a.amount;
      continue;
    }
    const b = bucket(providerKeyOf(a.channelCode));
    addAdjustment(b.totals, a.amount);
    addAdjustment(channelOf(b, a.channelCode, a.channelName), a.amount);
    const d = b.daily.get(localDay(a.createdAt));
    if (d) addAdjustment(d, a.amount);
  }

  const providers = PROVIDERS.filter((p) => per.has(p.key)).map((p) => {
    const b = per.get(p.key)!;
    return {
      ...p,
      totals: finish(b.totals),
      channels: [...b.channels.values()].map(finish).sort((x, y) => y.total - x.total || y.labels - x.labels),
      daily: [...b.daily.values()].map(finish),
    };
  });
  const grand = empty();
  for (const p of providers) {
    for (const k of ["labels", "postage", "cancelled", "cancelFees", "adjustments", "adjCount", "exceptions", "exceptionCost", "rebate"] as const) grand[k] += p.totals[k];
  }
  return { from, to, providers, grand: finish(grand), unmatchedAdj: { count: unmatchedAdj.count, amount: r2(unmatchedAdj.amount) } };
}

/** 对账常用周期：服务商一般按周或按月出账 */
export function reconPresets(today = new Date()) {
  const d = (x: Date) => localDate(x);
  const shift = (base: Date, days: number) => {
    const x = new Date(base);
    x.setDate(x.getDate() + days);
    return x;
  };
  // 周一为一周的开始
  const weekStart = shift(today, -((today.getDay() + 6) % 7));
  const lastWeekStart = shift(weekStart, -7);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  return [
    { key: "week", label: "本周", from: d(weekStart), to: d(today) },
    { key: "lastweek", label: "上周", from: d(lastWeekStart), to: d(shift(weekStart, -1)) },
    { key: "month", label: "本月", from: d(monthStart), to: d(today) },
    { key: "lastmonth", label: "上月", from: d(lastStart), to: d(lastEnd) },
  ];
}
