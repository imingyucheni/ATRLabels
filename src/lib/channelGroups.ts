import { providerOf } from "./service";

/** 渠道按服务商分组显示（设置 → 物流渠道、客户详情 → 可用渠道） */
export const CHANNEL_GROUPS = [
  { provider: "ShipBest", label: "ShipBest（SB）" },
  { provider: "嘉谷", label: "嘉谷万邑（GDE）" },
  { provider: "DHL", label: "DHL Express 国际" },
] as const;

export function groupChannels<T extends { code: string }>(list: T[]) {
  return CHANNEL_GROUPS.map((g) => ({ ...g, list: list.filter((c) => providerOf(c.code) === g.provider) })).filter((g) => g.list.length);
}
