/** 电商平台对接（Shopify / eBay）共用的数据结构 */
import type { Address } from "../shipbest/types";

export type Platform = "shopify" | "ebay";

export const PLATFORM_LABEL: Record<Platform, string> = { shopify: "Shopify", ebay: "eBay" };

/** 平台订单统一成这个样子（只保留发货要用的信息） */
export interface StoreOrder {
  /** 平台上的订单 ID（Shopify 是 gid://shopify/Order/…，eBay 是 orderId） */
  extId: string;
  /** 卖家看到的订单号（Shopify 是 #1001，eBay 是 orderId） */
  name: string;
  createdAt: string;
  recipient: Address;
  items: { sku: string; name: string; quantity: number; unitPrice: number; currency: string }[];
  /** 整单重量（克）；平台没给时为 0 */
  weightGrams: number;
  /** 回传发货时要用的引用：Shopify 是 fulfillment order ID，eBay 是 lineItemId + 数量 */
  fulfillRefs: { id: string; quantity?: number }[];
  /**
   * 收件信息有问题、不能导入：
   * no_address = 订单没有收货地址；hidden = 平台隐藏了姓名 / 街道（Shopify 应用没开客户数据权限）
   */
  issue?: "no_address" | "hidden";
}

/** 回传给平台的发货信息 */
export interface TrackingPush {
  carrier: string;
  trackingNo: string;
  trackingUrl: string | null;
}

export interface FetchedOrders {
  orders: StoreOrder[];
  /** 平台说这些订单已经不需要发货了（取消 / 在别处发货） */
  closedExtIds?: string[];
}

/** 每个平台要实现的接口 */
export interface PlatformAdapter {
  fetchOpenOrders(): Promise<FetchedOrders>;
  /** 回传运单号，返回平台上的发货记录 ID */
  pushFulfillment(order: StoreOrder, t: TrackingPush): Promise<string | null>;
  /** 取消回传过的发货（平台不支持时抛错说明） */
  cancelFulfillment(fulfillmentId: string): Promise<void>;
}
