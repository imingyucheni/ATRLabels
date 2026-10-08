/**
 * 服务商接口速度（报价、地址核对）：记最近 100 次的耗时，设置页“接口速度”里看是哪家慢。
 * 只在内存里，重启后清零。
 */
type Sample = { at: number; ms: number; ok: boolean };

const g = globalThis as unknown as { __speedStats?: Map<string, Sample[]> };
const store: Map<string, Sample[]> = (g.__speedStats ??= new Map());

export function recordSpeed(provider: string, ms: number, ok: boolean) {
  const list = store.get(provider) ?? [];
  list.push({ at: Date.now(), ms, ok });
  if (list.length > 100) list.splice(0, list.length - 100);
  store.set(provider, list);
}

export interface SpeedSummary {
  provider: string;
  count: number;
  avgMs: number;
  p90Ms: number;
  maxMs: number;
  failed: number;
  lastAt: number;
}

/** 最近 24 小时的统计 */
export function speedSummary(now = Date.now()): SpeedSummary[] {
  const out: SpeedSummary[] = [];
  for (const [provider, list] of store) {
    const recent = list.filter((s) => now - s.at < 24 * 3600_000);
    if (!recent.length) continue;
    const ms = recent.map((s) => s.ms).sort((a, b) => a - b);
    out.push({
      provider,
      count: recent.length,
      avgMs: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length),
      p90Ms: ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.9))],
      maxMs: ms[ms.length - 1],
      failed: recent.filter((s) => !s.ok).length,
      lastAt: recent[recent.length - 1].at,
    });
  }
  return out.sort((a, b) => b.avgMs - a.avgMs);
}

/** 测试用 */
export function clearSpeedStats() {
  store.clear();
}
