"use client";

import { createContext, useContext } from "react";
import { Info } from "lucide-react";
import { carrierById, channelNameHint, localizeChannelName, publicChannel } from "@/lib/carriers";
import { useLang, useT } from "@/components/I18n";
import type { ChannelNameMap } from "@/lib/channelDisplay";

/** 客户端（OMS）里提供渠道名称映射；后台不提供，显示原名 */
const Ctx = createContext<ChannelNameMap | null>(null);

export function ChannelNamesProvider({ map, children }: { map: ChannelNameMap; children: React.ReactNode }) {
  return <Ctx.Provider value={map}>{children}</Ctx.Provider>;
}

/** 返回显示用的名称和物流商；没有映射（后台）时返回原名 */
export function useChannelDisplay() {
  const map = useContext(Ctx);
  const lang = useLang();
  // 名称里的中文服务说明（预上网、多箱）在英文界面换成英文
  const loc = (n: string) => localizeChannelName(n, lang);
  return (code: string | null | undefined, name?: string | null) => {
    if (!map) return { name: loc(name || code || ""), carrier: null as string | null };
    const hit = (code ? map[code] : undefined) ?? (name ? map[name] : undefined);
    if (hit) return { name: loc(hit.name), carrier: hit.carrier as string | null };
    return { name: loc(publicChannel(null, name || code || "").name), carrier: null as string | null };
  };
}

/** 物流商 logo（没有 logo 的显示文字标） */
export function CarrierMark({ carrier, size = "md" }: { carrier: string | null | undefined; size?: "sm" | "md" }) {
  if (!carrier) return null;
  const c = carrierById(carrier);
  return (
    <span className={`carrier-mark ${size}`} title={c.name}>
      {c.logo ? <img src={c.logo} alt={c.name} /> : <span className="carrier-text" style={{ color: c.color }}>{c.id === "other" ? "•" : c.name}</span>}
    </span>
  );
}

/** 渠道名称：客户端显示 logo + 干净名称；后台显示原名 */
export default function ChannelLabel({ code, name, logo = true, size = "sm" }: { code?: string | null; name?: string | null; logo?: boolean; size?: "sm" | "md" }) {
  const d = useChannelDisplay()(code, name);
  const t = useT();
  // “预上网”“多箱”这类说明：鼠标放上去显示是什么意思
  const hint = channelNameHint(d.name);
  return (
    <span className="channel-label" title={hint ? t(hint) : undefined}>
      {logo && <CarrierMark carrier={d.carrier} size={size} />}
      <span>{d.name || "-"}</span>
      {hint && <Info size={12} className="channel-hint" aria-label={t(hint)} />}
    </span>
  );
}
