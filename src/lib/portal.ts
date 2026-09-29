/**
 * 客户端看到的数据：去掉成本、利润、加价规则、ShipBest 内部信息。
 * 客户端页面和接口只能通过这里的函数取数据。
 */
import { customerChannels, db, getSettings, getShipment, listAdjustments, listShipments, type Shipment, type ShipmentFilter, type ShipmentStatus } from "./db";
import { displayChannel } from "./channelDisplay";
import type { ChannelQuote } from "./service";
import { stampFor, stampText } from "./stamp";
import type { Address, PackageInfo, SkuItem } from "./shipbest/types";

export interface PublicQuote {
  channelCode: string;
  channelName: string;
  ok: boolean;
  error?: string;
  zone?: string | null;
  price?: number;
  currency?: string;
}

export function toPublicQuote(q: ChannelQuote): PublicQuote {
  return {
    channelCode: q.channelCode,
    channelName: displayChannel(q.channelCode).name || q.channelName,
    ok: q.ok,
    error: q.ok ? undefined : publicQuoteError(q.error),
    zone: q.zone,
    price: q.price,
    currency: q.currency,
  };
}

/**
 * 报价失败给客户看的原因：只说大类，不给服务商的原始说明（例如“重量段基础费为0，请查看重量段配置……”）。
 * 后台看到的还是完整原因。
 */
export function publicQuoteError(msg?: string | null): string {
  const raw = msg ?? "";
  if (/不通邮|派送范围|未覆盖|not (be )?deliver|no service|邮编.*(不支持|不派|无法)/i.test(raw)) return "地址未覆盖：这个渠道送不到该邮编";
  if (/尺寸|长度|周长|体积|边长|size|length|girth|dimension/i.test(raw)) return "超出尺寸范围：这个渠道不支持该包裹尺寸";
  if (/重量段|分区价格|分区代码|重量|超重|weight|\boz\b|\blb/i.test(raw)) return "不支持该重量或地区";
  if (/余额不足/.test(raw) && !/账户余额不足|balance sufficient/i.test(raw)) return publicError(raw);
  return "该渠道暂时无法报价";
}

/** 批量导入某一行的报错（客户看）：报价失败只说大类，其他按 publicError 过滤 */
export function publicRowError(msg: string): string {
  if (msg.startsWith("余额不足")) return msg;
  const m = msg.match(/^所有渠道都无法报价[：:]\s*([\s\S]*)$/);
  if (m) return `所有渠道都无法报价：${publicQuoteError(m[1])}`;
  return publicError(msg);
}

/** ShipBest 的报错里可能带内部信息，客户端只保留对客户有用的部分 */
/** 客户页面可能用到的渠道代码：开通的渠道 + 订单 / 批量导入里出现过的 */
export function portalChannelCodes(customerId: number): string[] {
  const codes = new Set(customerChannels(customerId).map((c) => c.code));
  const rows = db()
    .prepare(
      `SELECT DISTINCT channel_code AS c FROM shipments WHERE customer_id = ?
       UNION SELECT DISTINCT r.channel_code FROM batch_job_rows r JOIN batch_jobs j ON j.id = r.job_id WHERE j.customer_id = ? AND r.channel_code IS NOT NULL`,
    )
    .all(customerId, customerId) as { c: string | null }[];
  for (const r of rows) if (r.c) codes.add(r.c);
  return [...codes];
}

export function publicError(msg?: string | null): string {
  if (!msg) return "该渠道暂不可用";
  // 去掉错误码前缀，例如 “[10024] ”（只去开头或冒号后的，不动“邮编[78701]”这类内容）
  // 去掉服务商名称（客户不需要知道是哪家服务商）
  const raw = msg
    .replace(/(^|[：:]\s*)\[-?\d+\]\s*/g, "$1")
    .replace(/(嘉谷万邑|嘉谷|万邑|Jiagu|ShipBest)\s*[：:]\s*/gi, "")
    .replace(/嘉谷万邑|嘉谷|万邑|Jiagu/gi, "")
    .replace(/\bJG-\d+\b/g, "")
    .replace(/\s*·\s*(SB|GDE)\b/g, "")
    .replace(/[（(]设置\s*→[^）)]*[）)]/g, "");
  // 服务商接口异常（带着对方返回的原文）、后台配置问题：不给客户看细节
  if (/HTTP \d{3}|接口返回异常|非 JSON|没有设置仓库|没有启用或没有填写账号|渠道 \d+ /.test(raw)) return "系统繁忙，请稍后再试或联系客服";
  // 地址不在派送范围：统一说成“地址未覆盖”
  if (/不通邮|派送范围/.test(raw)) return "地址未覆盖：这个渠道送不到该邮编";
  // 服务商超时未出面单
  if (/分钟内未出面单/.test(raw) && /已自动.*取消/.test(raw)) return "该渠道出单超时，系统已自动取消并全额退回余额，请换其他渠道重新下单";
  if (/分钟内未出面单/.test(raw)) return "该渠道出单超时，还没有生成面单。请联系客服，或换其他渠道重新下单";
  if (raw.includes("还没有开通任何物流渠道")) return "您的账户还没有开通物流渠道，请联系客服开通";
  if (raw.includes("未开通此渠道")) return "您的账户未开通此渠道，请联系客服";
  // 涉及我们和 ShipBest 之间的账户、授权、余额等问题，不给客户看原因
  if (/授权|签名|OMS|TIMESTAMP|SIGN|token|服务商|ShipBest|账户余额不足|balance sufficient|api auth/i.test(raw)) {
    return "系统繁忙，请稍后再试或联系客服";
  }
  return raw;
}

export interface PortalShipment {
  id: number;
  customNo: string;
  customerRef: string | null;
  channelCode: string;
  /** 客户看到的渠道名称（不带仓库邮编） */
  channelName: string | null;
  zone: string | null;
  trackingNo: string | null;
  status: ShipmentStatus;
  price: number;
  currency: string;
  cancelFee: number | null;
  refundAmount: number | null;
  adjustment: number;
  hasLabel: boolean;
  labelMime: string | null;
  problem: string | null;
  /** 客服修改后重新下单的新单（这张原单已取消） */
  replacedBy: number | null;
  sender: Address;
  recipient: Address;
  pkg: PackageInfo;
  skuList: SkuItem[];
  remark: string | null;
  createdAt: string;
  /** 面单是否加印 SKU、印的文字 */
  stampOn: boolean;
  stampText: string;
  labelNote: string | null;
  /** 模拟 / 沙盒模式下的测试单 */
  isTest: boolean;
}

export function toPortalShipment(s: Shipment): PortalShipment {
  const stampCfg = stampFor(s);
  return {
    id: s.id,
    customNo: s.customNo,
    customerRef: s.customerRef,
    channelCode: s.channelCode,
    channelName: displayChannel(s.channelCode).name || s.channelName,
    zone: s.zone,
    trackingNo: s.trackingNo,
    status: s.status,
    price: s.price,
    currency: s.currency,
    cancelFee: s.status === "cancelled" ? s.cancelFee : null,
    refundAmount: s.status === "cancelled" ? s.refundAmount : null,
    adjustment: s.customerAdj,
    hasLabel: !!s.labelPath && s.status !== "cancelled",
    labelMime: s.labelMime,
    problem: s.status === "exception" ? publicError(s.errorMsg ?? undefined) : null,
    replacedBy: s.replacedBy,
    sender: s.sender,
    recipient: s.recipient,
    pkg: s.pkg,
    skuList: s.skuList,
    remark: s.remark,
    createdAt: s.createdAt,
    stampOn: !!stampCfg,
    stampText: stampText(s, stampCfg ?? getSettings().stamp),
    labelNote: s.labelNote,
    isTest: s.isTest,
  };
}

/** 只返回属于该客户的面单 */
export function getOwnShipment(customerId: number, id: number): PortalShipment | null {
  const s = getShipment(id);
  return s && s.customerId === customerId ? toPortalShipment(s) : null;
}

export function listOwnShipments(customerId: number, f: Omit<ShipmentFilter, "customerId"> = {}): PortalShipment[] {
  return listShipments({ ...f, customerId }).map(toPortalShipment);
}

export function ownsShipment(customerId: number, id: number): boolean {
  return getShipment(id)?.customerId === customerId;
}

export interface PortalAdjustment {
  id: number;
  batchId: number;
  shipmentId: number;
  customNo: string | null;
  trackingNo: string | null;
  amount: number;
  reason: string | null;
  createdAt: string;
}

export function listOwnAdjustments(customerId: number): PortalAdjustment[] {
  return listAdjustments({ customerId })
    .filter((a) => a.shipmentId && a.customerAmount)
    .map((a) => ({
      id: a.id,
      batchId: a.batchId,
      shipmentId: a.shipmentId!,
      customNo: a.customNo,
      trackingNo: a.trackingNo,
      amount: a.customerAmount,
      reason: a.reason,
      createdAt: a.createdAt,
    }));
}

/** 客户取消订单时要扣的手续费比例（给客户看） */
/** 取消时限（小时），0 = 不限 */
export function cancelWindowHours() {
  const h = Number(getSettings().cancelWindowHours ?? 48);
  return Number.isFinite(h) && h > 0 ? h : 0;
}

/** 下单时间（UTC，“YYYY-MM-DD HH:MM:SS”）加上时限后是否已过期 */
export function cancelWindowPassed(createdAt: string, now = Date.now()) {
  const h = cancelWindowHours();
  if (!h) return false;
  const t = Date.parse(createdAt.includes("T") ? createdAt : createdAt.replace(" ", "T") + "Z");
  return Number.isFinite(t) && now - t > h * 3600_000;
}

export function portalCancelFeePercent() {
  return getSettings().cancelFeePercent;
}
