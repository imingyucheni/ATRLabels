/**
 * 物流商（carrier）和客户看到的渠道名称。
 * ShipBest 的渠道名带仓库邮编（例如 “GOFO-（91710）”），客户端只显示干净的名称和物流商 logo。
 * 后台“设置 → 物流渠道”里可以改每个渠道给客户看的名称和物流商。
 */
export interface Carrier {
  id: string;
  /** 简称（渠道名里常见的写法） */
  name: string;
  /** 客户看到的全称 */
  fullName: string;
  /** public/carriers 下的 logo；没有时显示文字标 */
  logo?: string;
  /** 文字标的颜色 */
  color: string;
}

export const CARRIERS: Carrier[] = [
  { id: "usps", name: "USPS", fullName: "USPS", logo: "/carriers/usps.png", color: "#1c4d9c" },
  { id: "uniuni", name: "UniUni", fullName: "UniUni Express", logo: "/carriers/uniuni.svg", color: "#d9844a" },
  { id: "gofo", name: "GOFO", fullName: "Gofo Express", logo: "/carriers/gofo.png", color: "#e85b2a" },
  { id: "speedx", name: "SpeedX", fullName: "SpeedX", logo: "/carriers/speedx.png", color: "#1a1464" },
  { id: "swiftx", name: "SwiftX", fullName: "SwiftX", logo: "/carriers/swiftx.png", color: "#4b3fc7" },
  { id: "ywe", name: "YWE", fullName: "Yanwen Express", color: "#0f766e" },
  { id: "spx", name: "SPX", fullName: "SPX Express", color: "#ee4d2d" },
  { id: "ups", name: "UPS", fullName: "UPS", color: "#5a3a1a" },
  { id: "fedex", name: "FedEx", fullName: "FedEx", color: "#4d148c" },
  { id: "dhl", name: "DHL", fullName: "DHL", color: "#d40511" },
  { id: "ontrac", name: "OnTrac", fullName: "OnTrac", color: "#004b87" },
  { id: "other", name: "其他", fullName: "", color: "#5f6368" },
];

const byId = new Map(CARRIERS.map((c) => [c.id, c]));

/** 按渠道名猜物流商 */
export function guessCarrier(channelName: string): string {
  const n = (channelName || "").toUpperCase().replace(/\s+/g, "");
  if (n.includes("USPS")) return "usps";
  if (n.includes("UNIUNI") || n.startsWith("UNI")) return "uniuni";
  if (n.includes("GOFO")) return "gofo";
  if (n.includes("SPEEDX")) return "speedx";
  if (n.includes("SWIFTX")) return "swiftx";
  if (n.includes("YWE")) return "ywe";
  if (n.includes("SPX")) return "spx";
  if (n.includes("FEDEX")) return "fedex";
  if (n.includes("ONTRAC")) return "ontrac";
  if (/\bUPS\b|^UPS/.test(n)) return "ups";
  if (n.includes("DHL")) return "dhl";
  return "other";
}

/** 去掉渠道名里的仓库邮编 / 口岸后缀：“GOFO-（91710）” → “GOFO”，“YWE Air-91710” → “YWE Air” */
export function cleanChannelName(channelName: string): string {
  const s = (channelName || "")
    .replace(/[\s\-－_]*[（(]\s*\d{5}\s*[)）]\s*$/, "")
    .replace(/[\s\-－_]+\d{5}\s*$/, "")
    .trim();
  return s || channelName;
}

export function carrierById(id: string | null | undefined): Carrier {
  return byId.get(id || "") ?? byId.get("other")!;
}

/**
 * 默认的客户显示名称：用物流商全称，保留渠道名里的服务说明，去掉仓库邮编和口岸代码。
 * “GOFO-（91710）” → “Gofo Express”，“YWE Air-91710” → “Yanwen Express Air”，“SPX-LAX” → “SPX Express”
 */
export function defaultPublicName(channelName: string, carrierId?: string | null): string {
  // 带服务商后缀（例如“ · 嘉谷”）的渠道名全是服务商的内部写法（D价、不预上网、仓库代码），只显示物流商全称
  const tagged = /\s·\s*[^·]+$/.test(channelName || "");
  const own = (channelName || "").replace(/\s*·\s*[^·]+$/, "");
  const clean = cleanChannelName(own);
  const c = carrierById(carrierId || guessCarrier(own));
  if (!c.fullName) return tagged ? own.replace(/[\u3400-\u9fff（）()]+.*$/, "").trim() || own : clean;
  if (tagged || /[\u3400-\u9fff]/.test(clean)) return c.fullName;
  const short = c.name.toUpperCase();
  const up = clean.toUpperCase();
  const at = up.indexOf(short);
  if (at !== 0) return clean; // 名称不是以物流商简称开头：保持原样
  const rest = clean
    .slice(short.length)
    .replace(/^[\s\-－_]+/, "")
    .replace(/^[A-Z]{3}$/, "") // 只剩口岸代码（LAX / ONT）
    .trim();
  return rest ? `${c.fullName} ${rest}` : c.fullName;
}

/** 客户看到的渠道名称 + 物流商 */
export function publicChannel(ch: { name: string; displayName?: string | null; carrier?: string | null } | null | undefined, fallbackName = "") {
  const name = ch?.name ?? fallbackName;
  const carrier = ch?.carrier || guessCarrier(name);
  return {
    name: (ch?.displayName || "").trim() || defaultPublicName(name, carrier),
    carrier,
  };
}
