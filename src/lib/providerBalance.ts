/**
 * 服务商账户余额（后台首页显示）：
 * - 嘉谷：接口可以查（SearchBalance），缓存 5 分钟，查询超过 5 秒就先不显示
 * - ShipBest：接口没有查余额的功能，只能到 ShipBest OMS 后台看
 */
import { getJiaguClient } from "./shipbest/jiagu";

export interface ProviderBalance {
  usd: number;
  credit: number;
  type: string;
  at: number;
}

let cache: { at: number; value: ProviderBalance | null; error: string | null } | null = null;

/** 余额低于这个数就在首页标红提醒（美元） */
export const LOW_BALANCE_USD = 100;

export async function jiaguBalance(): Promise<{ value: ProviderBalance | null; error: string | null; enabled: boolean }> {
  const c = getJiaguClient();
  if (!c) return { value: null, error: null, enabled: false };
  if (cache && Date.now() - cache.at < 5 * 60_000) return { value: cache.value, error: cache.error, enabled: true };
  try {
    const r = await Promise.race([c.balance(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("查询超时")), 5000))]);
    cache = { at: Date.now(), value: r ? { ...r, at: Date.now() } : null, error: r ? null : "没有查到美元账户" };
  } catch (e) {
    cache = { at: Date.now(), value: null, error: (e as Error).message };
  }
  return { value: cache.value, error: cache.error, enabled: true };
}
