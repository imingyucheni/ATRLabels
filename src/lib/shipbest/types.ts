/** 单位制：1=g/cm，2=kg/cm，3=lb/in */
export type UnitSystem = 1 | 2 | 3;

export interface Address {
  nameFirst: string;
  nameLast: string;
  phone?: string;
  email?: string;
  corporateName?: string;
  taxIdValue?: string;
  /** 国家/地区二字码 */
  country: string;
  province?: string;
  city: string;
  area?: string;
  street?: string;
  houseNumber?: string;
  address1: string;
  address2?: string;
  zipCode: string;
}

export interface SkuItem {
  sku: string;
  productNameCn: string;
  productNameEn: string;
  quantity: number;
  declaredUnitPrice: number;
  declaredCurrency: string;
  hsCode: string;
  /** 1=带磁,2=不带磁,3=带电,4=不带电,5=液体，逗号分隔 */
  productNature: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  unit: UnitSystem;
}

export interface PackageInfo {
  length: number;
  width: number;
  height: number;
  weight: number;
  displayUnitSystem: UnitSystem;
  /** 0 不需要签名 1 直接签名 2 间接签名 3 成人签名 */
  signServiceType: 0 | 1 | 2 | 3;
  insuranceService: 0 | 1;
  insuranceFee?: number;
  currency: string;
}

export interface ShipmentRequest {
  sender: Address;
  recipient: Address;
  pkg: PackageInfo;
  skuList: SkuItem[];
}

export interface Product {
  code: string;
  name: string;
}

export interface FeeQuote {
  logisticsProductId: number;
  logisticsProductName: string;
  baseShippingFee: number;
  baseDiscountShippingFee: number;
  extraShippingFee: number;
  extraDiscountShippingFee: number;
  totalShippingFee: number;
  totalDiscountShippingFee: number;
  currency: string;
  /** 分区，例如 zone6（文档未列出，实际接口有返回） */
  zone?: string | null;
  /** 该渠道试算失败的原因（文档未列出，实际接口有返回） */
  errorMsg?: string | null;
}

/** ShipBest 订单状态 */
export const SB_STATUS: Record<number, string> = {
  1: "草稿",
  2: "待出单",
  3: "异常",
  4: "已打单",
  6: "已取消",
};

export interface OrderDetail {
  orderNo: string;
  customNo: string;
  logisticsProductCode: string;
  logisticsProductName: string;
  status: number;
  errorMsg?: string | null;
  trackingNo?: string | null;
  labelUrl?: string | null;
  feePrice?: number | null;
  feePriceCurrency?: string | null;
}

export interface ApiResult<T> {
  code: number;
  message: string;
  data: T;
  requestId: string;
}
