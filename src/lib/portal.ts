/**
 * 客户端看到的数据：去掉成本、利润、加价规则、ShipBest 内部信息。
 * 客户端页面和接口只能通过这里的函数取数据。
 */
import { getSettings, getShipment, listAdjustments, listShipments, type Shipment, type ShipmentFilter, type ShipmentStatus } from "./db";
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
    channelName: q.channelName,
    ok: q.ok,
    error: q.ok ? undefined : publicError(q.error),
    zone: q.zone,
    price: q.price,
    currency: q.currency,
  };
}

/** ShipBest 的报错里可能带内部信息，客户端只保留对客户有用的部分 */
export function publicError(msg?: string | null): string {
  if (!msg) return "该渠道暂不可用";
  // 去掉错误码前缀，例如 “[10024] ”（只去开头或冒号后的，不动“邮编[78701]”这类内容）
  const raw = msg.replace(/(^|[：:]\s*)\[-?\d+\]\s*/g, "$1");
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
}

export function toPortalShipment(s: Shipment): PortalShipment {
  const stampCfg = stampFor(s);
  return {
    id: s.id,
    customNo: s.customNo,
    customerRef: s.customerRef,
    channelName: s.channelName,
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
    sender: s.sender,
    recipient: s.recipient,
    pkg: s.pkg,
    skuList: s.skuList,
    remark: s.remark,
    createdAt: s.createdAt,
    stampOn: !!stampCfg,
    stampText: stampText(s, stampCfg ?? getSettings().stamp),
    labelNote: s.labelNote,
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
export function portalCancelFeePercent() {
  return getSettings().cancelFeePercent;
}
