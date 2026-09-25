import { db, getSettings } from "../db";
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

type MockOrder = OrderDetail & { createdAt: number; to?: string };

/** 模拟 / 沙盒订单存在数据库里，服务器重启后还能查到、取消 */
const mockOrders = {
  conn() {
    const c = db();
    c.exec("CREATE TABLE IF NOT EXISTS mock_orders (order_no TEXT PRIMARY KEY, custom_no TEXT NOT NULL UNIQUE, json TEXT NOT NULL)");
    return c;
  },
  get(orderNo: string): MockOrder | undefined {
    const r = this.conn().prepare("SELECT json FROM mock_orders WHERE order_no = ?").get(orderNo) as { json: string } | undefined;
    return r ? JSON.parse(r.json) : undefined;
  },
  byCustomNo(customNo: string): MockOrder | undefined {
    const r = this.conn().prepare("SELECT json FROM mock_orders WHERE custom_no = ?").get(customNo) as { json: string } | undefined;
    return r ? JSON.parse(r.json) : undefined;
  },
  save(o: MockOrder) {
    this.conn()
      .prepare("INSERT INTO mock_orders (order_no, custom_no, json) VALUES (?,?,?) ON CONFLICT(order_no) DO UPDATE SET json = excluded.json")
      .run(o.orderNo, o.customNo, JSON.stringify(o));
  },
};

/** 离线模拟：不调用真实接口，用于本地试用和测试。 */
export class MockShipBestClient implements ShipBestClient {
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

  async trialPrice(productCode: string, req: ShipmentRequest): Promise<FeeQuote | null> {
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
    const rated = rateQuote(productCode, req, this.products[idx].name);
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
    if (mockOrders.byCustomNo(customNo)) {
      throw new ShipBestError(10063, "custom no is repeat!");
    }
    const q = await this.trialPrice(productCode, req);
    if (!q) throw new ShipBestError(10061, "trial price failed");
    const orderNo = "SB" + Date.now() + String(++this.seq).padStart(4, "0");
    mockOrders.save({
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
    const o = key.orderNo ? mockOrders.get(key.orderNo) : key.customNo ? mockOrders.byCustomNo(key.customNo) : undefined;
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
      mockOrders.save(o);
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
    mockOrders.save(o);
  }
}

/**
 * 沙盒：渠道、报价、派送范围都调用 ShipBest 真实接口（不花钱），
 * 下单 / 面单 / 取消是模拟的，不会真实出单扣费。用来在上线前或测试新功能时核对真实价格。
 */
export class SandboxShipBestClient extends MockShipBestClient {
  constructor(private real: HttpShipBestClient) {
    super();
  }
  async verify() {
    await this.real.verify();
  }
  async getProducts() {
    return this.real.getProducts();
  }
  async trialPrice(productCode: string, req: ShipmentRequest): Promise<FeeQuote | null> {
    const q = await this.real.trialPrice(productCode, req);
    if (!q) throw new ShipBestError(10061, "trial price failed");
    return q;
  }
}

const g = globalThis as unknown as { __shipbestMock?: MockShipBestClient };

export type ShipBestMode = "mock" | "sandbox" | "live";

/** 这个站点是不是“沙盒站”（和正式站分开部署、数据分开）：沙盒站永远不会真实出单 */
export function isSandboxSite() {
  return process.env.APP_ENV === "sandbox";
}

/** 接口账号：后台“设置”里填写的优先，没填时用服务器环境变量 */
export function shipbestConfig() {
  const sb = getSettings().shipbest ?? { mode: "env", apiId: "", token: "" };
  const apiId = sb.apiId || process.env.SHIPBEST_API_ID || "";
  const token = sb.token || process.env.SHIPBEST_ACCESS_TOKEN || "";
  let mode: ShipBestMode =
    sb.mode === "mock" || sb.mode === "sandbox" || sb.mode === "live" ? sb.mode : process.env.SHIPBEST_MOCK === "1" ? "mock" : "live";
  // 沙盒站不允许真实出单：设置里是“正式”也按沙盒处理
  if (mode === "live" && isSandboxSite()) mode = "sandbox";
  // 沙盒站还没填 API 账号时先用模拟模式（能正常试用，不会报错）
  if (mode === "sandbox" && isSandboxSite() && (!apiId || !token)) mode = "mock";
  const baseUrl = (sb.baseUrl || process.env.SHIPBEST_BASE_URL || "https://oms.shipbest.com").trim();
  return { apiId, token, mode, mock: mode === "mock", baseUrl, source: sb.apiId ? "settings" : process.env.SHIPBEST_API_ID ? "env" : "none" };
}

/** 模拟模式：完全不连 ShipBest，价格按导入的报价表估算 */
export function isMockMode() {
  return shipbestConfig().mode === "mock";
}

/** 不是正式模式（模拟或沙盒）：面单都是模拟的，不会真实扣费 */
export function isTestMode() {
  return shipbestConfig().mode !== "live";
}

export function shipbestMode(): ShipBestMode {
  return shipbestConfig().mode;
}

let live: { key: string; client: ShipBestClient } | null = null;

export function getShipBestClient(): ShipBestClient {
  const c = shipbestConfig();
  if (c.mode === "mock") return (g.__shipbestMock ??= new MockShipBestClient());
  if (!c.apiId || !c.token) {
    throw new Error("还没有填写 ShipBest API ID / Token，请到后台“设置 → ShipBest 连接”填写");
  }
  const key = `${c.mode}|${c.baseUrl}|${c.apiId}|${c.token}`;
  if (live?.key !== key) {
    const http = new HttpShipBestClient(c.baseUrl, c.apiId, c.token);
    live = { key, client: c.mode === "sandbox" ? new SandboxShipBestClient(http) : http };
  }
  return live.client;
}
