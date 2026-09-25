/** 客户端显示用：渠道代码 / 原名 → 客户看到的名称 + 物流商 */
import { listChannels } from "./db";
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
