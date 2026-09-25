/**
 * 人民币充值汇率：当天实时汇率（美元兑人民币）+ 加点（例如 0.03）。
 * 默认每天更新一次：美西时间每天第一次用到时取当天实时汇率，全天固定（客户当天看到的都一样）；
 * 也可以在设置里改成每小时更新。获取失败时用最近一次的汇率，再不行用备用汇率。
 */
import { getSettings, saveSettings } from "./db";
import { fmtDate } from "./time";

export interface FxQuote {
  /** 实时汇率（1 USD = ? CNY） */
  live: number;
  /** 加点 */
  markup: number;
  /** 充值使用的汇率 = 实时汇率 + 加点 */
  rate: number;
  source: string;
  fetchedAt: string;
  /** 是否使用了手动 / 备用汇率 */
  manual: boolean;
}

const SOURCES: { name: string; url: string; pick: (j: unknown) => number | undefined }[] = [
  { name: "ExchangeRate-API", url: "https://open.er-api.com/v6/latest/USD", pick: (j) => (j as { rates?: { CNY?: number } }).rates?.CNY },
  { name: "Frankfurter（欧洲央行）", url: "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY", pick: (j) => (j as { rates?: { CNY?: number } }).rates?.CNY },
];

const TTL = 60 * 60 * 1000;
const g = globalThis as unknown as { __fx?: { live: number; source: string; at: number } };

async function fetchLive(): Promise<{ live: number; source: string } | null> {
  for (const s of SOURCES) {
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
      if (!res.ok) continue;
      const v = s.pick(await res.json());
      if (typeof v === "number" && v > 1 && v < 20) return { live: v, source: s.name };
    } catch {
      // 换下一个来源
    }
  }
  return null;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** 当前充值汇率。force = 忽略缓存重新获取 */
export async function usdCnyQuote(force = false): Promise<FxQuote> {
  const st = getSettings();
  const markup = st.fxMarkup;
  const manual = (live: number, source: string, at: string): FxQuote => ({ live, markup, rate: r4(live + markup), source, fetchedAt: at, manual: true });
  if (st.fxMode === "manual") return manual(st.fxManualRate, "手动设置", "");

  // 每天一次：今天已经取过就用今天的
  const today = fmtDate(new Date().toISOString());
  if (st.fxRefresh !== "hourly" && !force && st.fxDaily?.date === today) {
    const d = st.fxDaily;
    return { live: d.live, markup, rate: r4(d.live + markup), source: `${d.source} · ${d.date} 今日汇率`, fetchedAt: d.at, manual: false };
  }

  if (st.fxRefresh === "hourly" && !force && g.__fx && Date.now() - g.__fx.at < TTL) {
    return { live: g.__fx.live, markup, rate: r4(g.__fx.live + markup), source: g.__fx.source, fetchedAt: new Date(g.__fx.at).toISOString(), manual: false };
  }
  const got = await fetchLive();
  if (got) {
    g.__fx = { ...got, at: Date.now() };
    // 记住最近一次成功的汇率，服务重启或接口暂时不可用时使用
    const at = new Date().toISOString();
    saveSettings({ fxLast: { live: got.live, source: got.source, at }, fxDaily: { date: today, live: got.live, source: got.source, at } });
    return { live: got.live, markup, rate: r4(got.live + markup), source: got.source, fetchedAt: new Date().toISOString(), manual: false };
  }
  if (st.fxLast && Date.now() - Date.parse(st.fxLast.at) < 3 * 24 * TTL) {
    return { live: st.fxLast.live, markup, rate: r4(st.fxLast.live + markup), source: `${st.fxLast.source}（最近一次）`, fetchedAt: st.fxLast.at, manual: false };
  }
  return manual(st.fxManualRate, "备用汇率（实时汇率获取失败）", "");
}

/** 充值 usd 美元需要支付的人民币（向上取到分） */
export function cnyToPay(usd: number, rate: number): number {
  return Math.ceil(Math.round(usd * rate * 1e6) / 1e4) / 100;
}
