/** 客户端显示用：渠道代码 / 原名 → 客户看到的名称 + 物流商 */
import { getChannel, listChannels } from "./db";
import { publicChannel } from "./carriers";

export type ChannelNameMap = Record<string, { name: string; carrier: string }>;

// 列表页会查很多次：缓存几秒
let cache: { at: number; map: ChannelNameMap } | null = null;

export function clearChannelNameCache() {
  cache = null;
}

export function channelNameMap(): ChannelNameMap {
  if (cache && Date.now() - cache.at < 5000) return cache.map;
  const map: ChannelNameMap = {};
  for (const ch of listChannels()) {
    const p = publicChannel(ch);
    map[ch.code] = p;
    map[ch.name] = p;
  }
  cache = { at: Date.now(), map };
  return map;
}

/** 按代码或原名查客户看到的名称（查不到时去掉邮编后缀） */
export function displayChannel(codeOrName: string | null | undefined, map: ChannelNameMap = channelNameMap()) {
  if (!codeOrName) return { name: "", carrier: "other" };
  return map[codeOrName] ?? publicChannel(null, codeOrName);
}

/**
 * 客户看到的名称相同的渠道（例如两家服务商的 USPS）：同一个客户只能开通其中一个。
 * 找到第一组就返回 { publicName, names }，没有重复返回 null。
 */
export function sameNameChannels(codes: string[]) {
  const map = channelNameMap();
  const groups = new Map<string, { publicName: string; names: string[] }>();
  for (const code of codes) {
    const ch = getChannel(code);
    if (!ch) continue;
    const publicName = displayChannel(code, map).name.trim();
    const key = publicName.toLowerCase();
    const g = groups.get(key) ?? { publicName, names: [] };
    g.names.push(ch.name);
    groups.set(key, g);
  }
  for (const g of groups.values()) if (g.names.length > 1) return g;
  return null;
}
