import { getSettings } from "../db";
import { coverageFor } from "../coverage";
import { rateQuote } from "../rates";
import { buildHeaders } from "./sign";
import type {
  ApiResult,
  FeeQuote,
  OrderDetail,
  Product,
  ShipmentRequest,
} from "./types";

/** 常见错误码的中文说明（完整列表见 ShipBest 文档“常见报错”）。 */
const ERROR_HINTS: Record<number, string> = {
  [-1]: "ShipBest 系统维护升级中",
  10022: "物流产品不存在",
  10023: "物流产品已停用",
  10024: "包裹重量不在该渠道的下单重量范围内",
  10061: "运费试算失败",
  10062: "该物流产品没有设置价格，请联系 ShipBest",
  10063: "自定义单号重复",
  11004: "API 授权信息无效（检查 apiId / accessToken）",
  11005: "请求频率超限，请稍后再试",
  11012: "签名错误",
  11013: "重复提交",
  11014: "时间戳无效（检查服务器时间）",
  11200: "OMS 账户余额不足，请先充值",
  11201: "OMS 账号已被停用",
  11202: "订单在 ShipBest 系统中不存在",
  11203: "该订单不支持取消",
  11204: "订单已取消，不能重复取消",
  11205: "订单异常，不支持取消",
  11206: "创建订单异常",
};

export class ShipBestError extends Error {
  constructor(
    public code: number,
    public apiMessage: string,
    public requestId?: string,
  ) {
    const hint = ERROR_HINTS[code];
    super(`[${code}] ${hint ? `${hint}（${apiMessage}）` : apiMessage}`);
    this.name = "ShipBestError";
  }
}

export interface ShipBestClient {
  verify(): Promise<void>;
  getProducts(): Promise<Product[]>;
  /** 按指定渠道试算运费 */
  trialPrice(productCode: string, req: ShipmentRequest): Promise<FeeQuote | null>;
  createOrder(customNo: string, productCode: string, req: ShipmentRequest, remark?: string): Promise<unknown>;
  getOrder(key: { orderNo?: string; customNo?: string }): Promise<OrderDetail>;
  cancelOrder(key: { orderNo?: string; customNo?: string }): Promise<void>;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 组装试算 / 下单共用的请求体字段。 */
export function buildOrderBody(productCode: string, req: ShipmentRequest) {
  const { pkg, skuList } = req;
  const declaredAmount = skuList.reduce((s, i) => s + i.declaredUnitPrice * i.quantity, 0);
  const declareQuantity = skuList.reduce((s, i) => s + i.quantity, 0);
  return {
    logisticsProductCode: productCode,
    insuranceService: pkg.insuranceService,
    ...(pkg.insuranceService ? { insuranceFee: pkg.insuranceFee } : {}),
    insuranceFeeCurrency: pkg.currency,
    signServiceType: pkg.signServiceType,
    length: pkg.length,
    width: pkg.width,
    height: pkg.height,
    weight: pkg.weight,
    displayUnitSystem: pkg.displayUnitSystem,
    declareQuantity,
    declaredAmount: Math.round(declaredAmount * 100) / 100,
    declaredAmountCurrency: pkg.currency,
    recipientAddressQo: req.recipient,
    sendAddressQo: req.sender,
    skuList,
  };
}

export class HttpShipBestClient implements ShipBestClient {
  constructor(
    private baseUrl: string,
    private apiId: string,
    private accessToken: string,
  ) {}

  private async call<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.baseUrl.replace(/\/$/, "") + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildHeaders(this.apiId, this.accessToken, path),
      },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const text = await res.text();
    let json: ApiResult<T>;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ShipBestError(res.status, `非 JSON 响应: ${text.slice(0, 200)}`);
    }
    if (json.code !== 0) throw new ShipBestError(json.code, json.message, json.requestId);
    return json.data;
  }

  async verify() {
    await this.call("/api/oauth/verify", {});
  }

  async getProducts() {
    const data = await this.call<{ productVoList?: Product[] }>("/api/logistics/getProducts", {});
    return data?.productVoList ?? [];
  }

  async trialPrice(productCode: string, req: ShipmentRequest) {
    const data = await this.call<{ orderFeeCalcVos?: FeeQuote[] }>(
      "/api/logistics/trialOrderPrice",
      buildOrderBody(productCode, req),
    );
    const q = data?.orderFeeCalcVos?.[0];
    if (!q) return null;
    if (q.errorMsg) throw new ShipBestError(10061, q.errorMsg);
    return {
      ...q,
      baseShippingFee: num(q.baseShippingFee),
      baseDiscountShippingFee: num(q.baseDiscountShippingFee),
      extraShippingFee: num(q.extraShippingFee),
      extraDiscountShippingFee: num(q.extraDiscountShippingFee),
      totalShippingFee: num(q.totalShippingFee),
      totalDiscountShippingFee: num(q.totalDiscountShippingFee),
    };
  }

  async createOrder(customNo: string, productCode: string, req: ShipmentRequest, remark?: string) {
    return this.call("/api/order/create", {
      customNo,
      ...buildOrderBody(productCode, req),
      ...(remark ? { remark } : {}),
    });
  }

  async getOrder(key: { orderNo?: string; customNo?: string }) {
    return this.call<OrderDetail>("/api/order/detail", key);
  }

  async cancelOrder(key: { orderNo?: string; customNo?: string }) {
    await this.call("/api/order/cancel", key);
  }
}

/** 离线模拟：不调用真实接口，用于本地试用和测试。 */
export class MockShipBestClient implements ShipBestClient {
  private orders = new Map<string, OrderDetail & { createdAt: number; to?: string }>();
  private seq = 0;
  // 与真实账号的渠道名一致，方便演示和导入 ShipBest 导单表
  private products: Product[] = [
    { code: "LP10210028", name: "UniUni-（91710）" },
    { code: "LP10210029", name: "GOFO-（91710）" },
    { code: "LP10210030", name: "USPS-（91710）" },
    { code: "LP10210433", name: "SwiftX-91710" },
    { code: "LP10210434", name: "YWE-91710" },
    { code: "LP10210435", name: "YWE Air-91710" },
    { code: "LP10210701", name: "SPX-LAX" },
  ];
  /** 没有导入报价表时的粗略价格：[基础价, 每磅] —— 不同重量下最便宜的渠道不同 */
  private rates: [number, number][] = [[3.0, 0.55], [3.2, 0.45], [4.6, 0.8], [2.9, 0.75], [3.1, 0.62], [3.3, 0.6], [3.0, 0.5]];

  async verify() {}

  async getProducts() {
    return this.products;
  }

  async trialPrice(productCode: string, req: ShipmentRequest) {
    const idx = this.products.findIndex((p) => p.code === productCode);
    if (idx < 0) throw new ShipBestError(10022, "Logistics product not exist!");
    const { weight, displayUnitSystem: u } = req.pkg;
    const lb = u === 1 ? weight / 453.6 : u === 2 ? weight * 2.2046 : weight;
    // 模拟部分渠道不覆盖某些地区（真实情况会返回“不通邮”）
    if ((idx === 3 || idx === 4) && req.recipient.zipCode.startsWith("2")) {
      throw new ShipBestError(1, `国家[${req.recipient.country}],邮编[${req.recipient.zipCode}]不通邮`);
    }
    // 上传了邮编表的渠道：不在表里的邮编按“不通邮”处理（和真实接口一样）
    const cov = coverageFor(productCode, req.recipient.zipCode);
    if (cov && !cov.covered) {
      throw new ShipBestError(1, `国家[${req.recipient.country}],邮编[${req.recipient.zipCode}]不通邮`);
    }
    // 上传了服务商报价表的渠道：按“重量 + 分区”查成本价（没有折扣）
    const rated = rateQuote(productCode, req);
    if (rated) {
      const extra = req.pkg.signServiceType ? 3 : 0;
      const total = Math.round((rated.price + extra) * 100) / 100;
      return {
        logisticsProductId: idx + 1,
        logisticsProductName: this.products[idx].name,
        baseShippingFee: rated.price,
        baseDiscountShippingFee: rated.price,
        extraShippingFee: extra,
        extraDiscountShippingFee: extra,
        totalShippingFee: total,
        totalDiscountShippingFee: total,
        currency: "USD",
        zone: `zone${rated.zone}`,
      };
    }
    const [b, per] = this.rates[idx];
    const base = Math.round((b + lb * per) * 100) / 100;
    const extra = req.pkg.signServiceType ? 3 : 0;
    const discount = Math.round(base * 0.92 * 100) / 100;
    return {
      logisticsProductId: idx + 1,
      logisticsProductName: this.products[idx].name,
      baseShippingFee: base,
      baseDiscountShippingFee: discount,
      extraShippingFee: extra,
      extraDiscountShippingFee: extra,
      totalShippingFee: base + extra,
      totalDiscountShippingFee: Math.round((discount + extra) * 100) / 100,
      currency: "USD",
      zone: `zone${Math.min(8, 2 + (req.recipient.zipCode.charCodeAt(0) % 7))}`,
    };
  }

  async createOrder(customNo: string, productCode: string, req: ShipmentRequest) {
    if ([...this.orders.values()].some((o) => o.customNo === customNo)) {
      throw new ShipBestError(10063, "custom no is repeat!");
    }
    const q = await this.trialPrice(productCode, req);
    const orderNo = "SB" + Date.now() + String(++this.seq).padStart(4, "0");
    this.orders.set(orderNo, {
      orderNo,
      customNo,
      logisticsProductCode: productCode,
      logisticsProductName: q.logisticsProductName,
      status: 2,
      feePrice: q.totalDiscountShippingFee,
      feePriceCurrency: q.currency,
      createdAt: Date.now(),
      to: [`${req.recipient.nameFirst} ${req.recipient.nameLast}`, req.recipient.address1, `${req.recipient.city} ${req.recipient.province ?? ""} ${req.recipient.zipCode}`].join("|"),
    });
    return {};
  }

  private find(key: { orderNo?: string; customNo?: string }) {
    const o = key.orderNo
      ? this.orders.get(key.orderNo)
      : [...this.orders.values()].find((x) => x.customNo === key.customNo);
    if (!o) throw new ShipBestError(11202, "The order was not found in the system!");
    return o;
  }

  async getOrder(key: { orderNo?: string; customNo?: string }) {
    const o = this.find(key);
    // 模拟异步出单：创建 1 秒后变成已打单
    if (o.status === 2 && Date.now() - o.createdAt > 1000) {
      o.status = 4;
      o.trackingNo = "9400" + String(Date.now()).slice(-10) + String(++this.seq).padStart(6, "0");
      o.labelUrl = `mock://label/${o.customNo}?ch=${encodeURIComponent(o.logisticsProductName)}&t=${o.trackingNo}&to=${encodeURIComponent(o.to ?? "")}`;
    }
    const { createdAt: _, to: __, ...detail } = o;
    return { ...detail };
  }

  async cancelOrder(key: { orderNo?: string; customNo?: string }) {
    const o = this.find(key);
    if (o.status === 6) throw new ShipBestError(11204, "The order is Cancelled not cancel repeated !");
    // 真实情况：已打单的订单需联系 ShipBest 人工取消
    if (o.status === 4) throw new ShipBestError(11203, "The order was nonsupport cancelled!");
    o.status = 6;
  }
}

const g = globalThis as unknown as { __shipbestMock?: MockShipBestClient };

/** 接口账号：后台“设置”里填写的优先，没填时用服务器环境变量 */
export function shipbestConfig() {
  const sb = getSettings().shipbest ?? { mode: "env", apiId: "", token: "" };
  const apiId = sb.apiId || process.env.SHIPBEST_API_ID || "";
  const token = sb.token || process.env.SHIPBEST_ACCESS_TOKEN || "";
  const mock = sb.mode === "mock" ? true : sb.mode === "live" ? false : process.env.SHIPBEST_MOCK === "1";
  return { apiId, token, mock, source: sb.apiId ? "settings" : process.env.SHIPBEST_API_ID ? "env" : "none" };
}

export function isMockMode() {
  return shipbestConfig().mock;
}

let live: { key: string; client: HttpShipBestClient } | null = null;

export function getShipBestClient(): ShipBestClient {
  const c = shipbestConfig();
  if (c.mock) return (g.__shipbestMock ??= new MockShipBestClient());
  if (!c.apiId || !c.token) {
    throw new Error("还没有填写 ShipBest API ID / Token，请到后台“设置 → ShipBest 连接”填写");
  }
  const base = process.env.SHIPBEST_BASE_URL || "https://oms.shipbest.com";
  const key = `${base}|${c.apiId}|${c.token}`;
  if (live?.key !== key) live = { key, client: new HttpShipBestClient(base, c.apiId, c.token) };
  return live.client;
}
