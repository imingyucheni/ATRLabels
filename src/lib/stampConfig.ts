/** 面单加印 SKU 的配置（前后端共用，不能引用服务端模块） */

export interface StampConfig {
  /** 距面单左边（英寸） */
  x: number;
  /** 距面单上边（英寸） */
  y: number;
  /** 字号（pt） */
  fontSize: number;
  /** 最大宽度（英寸），超出自动换行 / 缩小 */
  maxWidth: number;
  /** 最多几行 */
  maxLines: number;
  /** 文字旋转角度 */
  rotate: 0 | 90 | 180 | 270;
  /** 文字下面加白底，避免和面单内容重叠看不清 */
  whiteBg: boolean;
  bold: boolean;
  /** 前缀，例如 “SKU: ” */
  prefix: string;
  /** 数量大于 1 时显示 “x数量” */
  showQty: boolean;
  /** 多个 SKU 之间的分隔符 */
  separator: string;
}

export const DEFAULT_STAMP: StampConfig = {
  x: 0.15,
  y: 5.55,
  fontSize: 10,
  maxWidth: 3.7,
  maxLines: 2,
  rotate: 0,
  whiteBg: true,
  bold: true,
  prefix: "SKU: ",
  showQty: true,
  separator: " / ",
};

/** 全局设置（是否默认开启 + 默认位置） */
export interface StampSettings extends StampConfig {
  enabled: boolean;
  /** 自动检查面单：已有 SKU 不加印，有文字没 SKU 自动加印（不设置 = 开启） */
  autoDetect?: boolean;
}

/**
 * 渠道单独设置（不同承运商面单版式不同）。
 * enabled：true 该渠道加印 / false 不加印（例如 ShipBest 已在备注里印了 SKU）/ 不设置则跟随全局。
 */
export type StampOverride = Partial<Pick<StampConfig, "x" | "y" | "fontSize" | "maxWidth" | "rotate" | "maxLines">> & { enabled?: boolean };

/**
 * USPS 面单的默认加印位置：最下面一栏的左侧空白（条码框下方、右下角二维码左边）。
 * 其他渠道（UniUni、GOFO、SwiftX 等）ShipBest 已经在备注里印了 SKU，默认不加印。
 */
export const USPS_PRESET: StampOverride = { enabled: true, x: 0.15, y: 5.45, maxWidth: 2.8, fontSize: 10 };

/**
 * FedEx（Ground / Home Delivery / Economy）面单的默认加印位置：运单号 TRK# 下面、条码数字上面的空白
 * （右边是邮编路由码，宽度留到它左边）。另一个可用的空白是最下面条码的下方（y ≈ 5.7，只放得下一行）。
 * 不强制开启：面单自带 SKU 时自动检查会跳过，图片面单跟随全局开关。
 */
export const FEDEX_PRESET: StampOverride = { x: 0.2, y: 3.9, maxWidth: 2.5, fontSize: 10 };

/**
 * FedEx SmartPost（FedEx Economy / Ground Economy，最后一段由 USPS 派送）面单版式不一样：
 * 运单号那块下面是收件人（USPS DELIVER TO），放 FedEx 的位置会盖住收件人。
 * 改放在上面 CUST REF 条码下方、“FedEx Tracking ID#” 上方的空白里，只放一行（放不下自动缩小字号）。
 */
export const FEDEX_SMARTPOST_PRESET: StampOverride = { x: 0.42, y: 2.05, maxWidth: 2.35, fontSize: 9, maxLines: 1 };

export const isSmartPostName = (name: string) => /fedex/i.test(name) && /smart\s*post|\bsmp\b|economy/i.test(name);

export function presetForChannel(name: string): StampOverride | null {
  if (/usps/i.test(name)) return USPS_PRESET;
  if (isSmartPostName(name)) return FEDEX_SMARTPOST_PRESET;
  if (/fedex/i.test(name)) return FEDEX_PRESET;
  // DHL 国际件：面单版式紧凑，品名 / SKU 在商业发票上，默认不加印
  if (/\bDHL\b/i.test(name)) return { enabled: false };
  return null;
}

export function mergeStamp(base: StampConfig, o?: StampOverride | null): StampConfig {
  return { ...base, ...Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => k !== "enabled" && v !== null && v !== undefined)) };
}
