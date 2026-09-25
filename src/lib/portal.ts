/**
 * 客户端看到的数据：去掉成本、利润、加价规则、ShipBest 内部信息。
 * 客户端页面和接口只能通过这里的函数取数据。
 */
import { getSettings, getShipment, listAdjustments, listShipments, type Shipment, type ShipmentFilter, type ShipmentStatus } from "./db";
import type { ChannelQuote } from "./service";
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
export function publicError(msg?: string): string {
  if (!msg) return "该渠道暂不可用";
  // 去掉错误码和我们加的中文提示前缀，只保留原因
  const m = /（(.+)）$/.exec(msg);
  const raw = (m ? m[1] : msg).replace(/^\[\-?\d+\]\s*/, "");
  if (/授权|签名|余额不足|OMS|TIMESTAMP|SIGN|token/i.test(raw)) return "系统繁忙，请稍后再试或联系客服";
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
}

export function toPortalShipment(s: Shipment): PortalShipment {
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
    hasLabel: !!s.labelPath,
    labelMime: s.labelMime,
    problem: s.status === "exception" ? publicError(s.errorMsg ?? undefined) : null,
    sender: s.sender,
    recipient: s.recipient,
    pkg: s.pkg,
    skuList: s.skuList,
    remark: s.remark,
    createdAt: s.createdAt,
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
