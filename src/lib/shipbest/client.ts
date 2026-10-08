import { db, getSettings, storedMode } from "../db";
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

import { providerFetch, ShipBestError } from "./errors";
import { getJiaguClient, isJiaguCode, jgOrders, type JiaguClient } from "./jiagu";
import { DhlClient, dhlConfig, DhlError, dhlOrders, dhlSettings, isDhlCode, mockDhlTransport, type DhlConfig } from "./dhl";
import { mockLabelPdf } from "../labels";
import { multiBoxRule, summarizePieces } from "../multiBox";
import { logProviderEvent } from "../providerLog";

/** ShipBest 渠道名后面加的标记（只有后台看得到，客户看到的是物流商名称） */
export const SB_SUFFIX = " · SB";
export { ShipBestError };

export interface ShipBestClient {
  verify(): Promise<void>;
  getProducts(): Promise<Product[]>;
  /** 按指定渠道试算运费 */
  trialPrice(productCode: string, req: ShipmentRequest): Promise<FeeQuote | null>;
  /** 同步渠道：几家服务商分别取，一家失败不影响其他家（返回成功取到的渠道 + 失败的原因） */
  getProductsDetailed?(): Promise<{ products: Product[]; errors: string[] }>;
  /** 一次给多个渠道报价（服务商支持合并请求时才有，例如嘉谷）：渠道代码 → 报价 */
  trialPriceMany?(codes: string[], req: ShipmentRequest): Map<string, Promise<FeeQuote | null>>;
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

  private async call<T>(path: string, body: unknown, timeoutMs = 30_000): Promise<T> {
    const { res, text } = await providerFetch("ShipBest", this.baseUrl.replace(/\/$/, "") + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildHeaders(this.apiId, this.accessToken, path),
      },
      body: JSON.stringify(body ?? {}),
      timeoutMs,
    });
    let json: ApiResult<T>;
    try {
      json = JSON.parse(text);
    } catch {
      // 网关超时（502/504 的 HTML 页）等：不是服务商的明确拒绝，按“结果未知”处理，不能当作下单失败删单退款
      throw new Error(`ShipBest 接口返回异常（HTTP ${res.status}）${text.slice(0, 120)}`);
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
      // 只是查价：最多等 15 秒（下单仍等 30 秒）
      15_000,
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
/** 演示用的多箱渠道价格（嘉谷结算价表，每 100 磅，Zone 2–8） */
const MOCK_MULTI_RATES = [
  { match: /HWT/, upTo500: [16.6585, 18.4842, 19.7089, 23.5192, 29.6087, 34.2922, 39.9508], over500: [12.8255, 16.0688, 17.1347, 20.4574, 25.6851, 29.6087, 34.4736], min: 81.6026 },
  { match: /MWT/, upTo500: [16.968, 18.5745, 19.8135, 23.625, 29.757, 34.44, 40.131], over500: [12.8835, 16.1385, 17.2095, 20.559, 25.7985, 29.757, 34.6605], min: 83.1285 },
];

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
    // 多箱渠道（一票多箱，演示用）：按 UPS HWT 结算价表算
    { code: "LP10219918", name: "UPS-NEW-HWT-XT" },
    { code: "LP10219919", name: "FEDEX-MWT-XT" },
  ];
  /** 没有导入报价表时的粗略价格：[基础价, 每磅] —— 不同重量下最便宜的渠道不同 */
  private rates: [number, number][] = [[3.0, 0.55], [3.2, 0.45], [4.6, 0.8], [2.9, 0.75], [3.1, 0.62], [3.3, 0.6], [3.0, 0.5], [0, 0], [0, 0]];

  async verify() {}

  async getProducts() {
    return this.products;
  }

  async trialPrice(productCode: string, req: ShipmentRequest): Promise<FeeQuote | null> {
    // 演示 / 测试用：模拟慢接口（MOCK_DELAY_MS）；MOCK_DELAY_SPREAD=1 时各渠道快慢不同（看边查边报的效果）
    const idx = this.products.findIndex((p) => p.code === productCode);
    const delayMs = Number(process.env.MOCK_DELAY_MS) || 0;
    const delay = process.env.MOCK_DELAY_SPREAD === "1" ? Math.round((delayMs * (Math.max(0, idx) + 1)) / this.products.length) : delayMs;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    if (idx < 0) throw new ShipBestError(10022, "Logistics product not exist!");
    const zoneN = Math.min(8, 2 + (req.recipient.zipCode.charCodeAt(0) % 7));
    const mbRate = MOCK_MULTI_RATES.find((m) => m.match.test(this.products[idx].name));
    if (mbRate) {
      // 多箱（每 100 磅）：200–500 lb / 500 lb 以上两档，有最低收费；计费重按渠道规则（体积重、平均 25 lb、AHS / 超尺寸最低计费重）
      if (!req.pkg.pieces?.length) throw new ShipBestError(10061, "多箱渠道需要多个包裹");
      const s = summarizePieces(req.pkg.pieces, multiBoxRule(this.products[idx].name));
      const tier = s.billable >= 500 ? mbRate.over500 : mbRate.upTo500;
      const fee = Math.round(Math.max(mbRate.min, (s.billable / 100) * tier[zoneN - 2]) * 100) / 100;
      return { logisticsProductId: idx + 1, logisticsProductName: this.products[idx].name, baseShippingFee: fee, baseDiscountShippingFee: fee, extraShippingFee: 0, extraDiscountShippingFee: 0, totalShippingFee: fee, totalDiscountShippingFee: fee, currency: "USD", zone: `zone${zoneN}` };
    }
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
    const provider = isJiaguCode(o.logisticsProductCode) ? "嘉谷" : isDhlCode(o.logisticsProductCode) ? "DHL" : null;
    // ShipBest 的单按真实规则：已打单的订单需联系 ShipBest 人工取消（说明里写清楚是模拟单）
    if (o.status === 4 && !provider) throw new ShipBestError(11203, "模拟订单，和真实 ShipBest 一样已打单不能接口取消：The order was nonsupport cancelled!");
    o.status = 6;
    mockOrders.save(o);
    // 嘉谷 / DHL 的模拟单：真实接口出面单后也能作废（嘉谷 VoidShipment；DHL 没揽收就作废），模拟时直接取消成功，不连服务商
    if (provider) logProviderEvent(o.customNo, provider, "模拟取消", null, `模拟订单（沙盒 / 模拟模式）：直接取消成功，没有连接${provider}`);
  }
}

/**
 * 沙盒：渠道、报价、派送范围都调用 ShipBest 真实接口（不花钱），
 * 下单 / 面单 / 取消是模拟的，不会真实出单扣费。用来在上线前或测试新功能时核对真实价格。
 */
export class SandboxShipBestClient extends MockShipBestClient {
  constructor(private real: ShipBestClient) {
    super();
  }
  async verify() {
    await this.real.verify();
  }
  async getProducts() {
    return this.real.getProducts();
  }
  async getProductsDetailed() {
    return this.real.getProductsDetailed ? this.real.getProductsDetailed() : { products: await this.real.getProducts(), errors: [] };
  }
  async trialPrice(productCode: string, req: ShipmentRequest): Promise<FeeQuote | null> {
    const q = await this.real.trialPrice(productCode, req);
    if (!q) throw new ShipBestError(10061, "trial price failed");
    return q;
  }
  trialPriceMany(codes: string[], req: ShipmentRequest) {
    const m = this.real.trialPriceMany?.(codes, req) ?? new Map<string, Promise<FeeQuote | null>>();
    for (const [code, p] of m) m.set(code, p.then((q) => { if (!q) throw new ShipBestError(10061, "trial price failed"); return q; }));
    return m;
  }
}

/**
 * 多个服务商：按渠道代码分给 ShipBest 或嘉谷（JG- 开头）。
 * 订单查询 / 取消按自定义单号判断是哪家的单（嘉谷的单在 provider_orders 里有记录）。
 */
export class MultiProviderClient implements ShipBestClient {
  /**
   * opts.dhlTestOnLive：正式模式下 DHL 还是测试环境 → DHL 渠道不报价、不出单（测试环境的面单不能真实寄件，客户付了钱拿到的是无效面单）。
   * 已经出的 DHL 单照常查询、取消。
   */
  constructor(private sb: ShipBestClient | null, private jg: JiaguClient | null, private dhl: DhlClient | null = null, private opts: { dhlTestOnLive?: boolean } = {}) {}

  /** 同样的服务商，但不拦 DHL 测试环境：给内部测试账号用（下单是模拟的，DHL 测试环境报价没关系） */
  withoutDhlGuard(): MultiProviderClient {
    return this.opts.dhlTestOnLive ? new MultiProviderClient(this.sb, this.jg, this.dhl) : this;
  }

  private isDhlOrder(key: { orderNo?: string; customNo?: string }) {
    return !!this.dhl && !!key.customNo && !!dhlOrders.get(key.customNo);
  }

  private dhlOr(): DhlClient {
    if (!this.dhl) throw new ShipBestError(10023, "DHL 没有启用或账号没填完整（设置 → DHL Express）");
    if (this.opts.dhlTestOnLive) throw new DhlError(10023, DHL_TEST_ON_LIVE_MSG);
    return this.dhl;
  }

  private pick(code: string): ShipBestClient | JiaguClient | DhlClient {
    if (isDhlCode(code)) return this.dhlOr();
    if (isJiaguCode(code)) {
      if (!this.jg) throw new ShipBestError(10023, "嘉谷接口没有启用或没有填写账号（设置 → 嘉谷万邑）");
      return this.jg;
    }
    if (!this.sb) throw new ShipBestError(11004, "还没有填写 ShipBest API ID / Token（设置 → ShipBest 连接）");
    return this.sb;
  }

  private isJgOrder(key: { orderNo?: string; customNo?: string }) {
    return !!this.jg && !!key.customNo && !!jgOrders.get(key.customNo);
  }

  async verify() {
    if (this.sb) await this.sb.verify();
    if (this.jg) await this.jg.verify();
    if (this.dhl) await this.dhl.verify();
  }

  async getProducts() {
    const r = await this.getProductsDetailed();
    if (r.errors.length) throw new Error(r.errors.join("；"));
    return r.products;
  }

  /** 几家服务商同时取渠道；一家超时 / 出错不影响其他家 */
  async getProductsDetailed() {
    const jobs: [string, Promise<Product[]>][] = [];
    if (this.sb) jobs.push(["ShipBest", this.sb.getProducts().then((list) => list.map((p) => ({ ...p, name: p.name.endsWith(SB_SUFFIX) ? p.name : `${p.name}${SB_SUFFIX}` })))]);
    if (this.jg) jobs.push(["嘉谷", this.jg.getProducts()]);
    if (this.dhl) jobs.push(["DHL", this.dhl.getProducts()]);
    const settled = await Promise.allSettled(jobs.map(([, p]) => p));
    const products: Product[] = [];
    const errors: string[] = [];
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") products.push(...s.value);
      else {
        const msg = (s.reason as Error)?.message ?? String(s.reason);
        // 错误里已经带服务商名（例如“嘉谷 接口超时…”）就不再加
        errors.push(msg.includes(jobs[i][0]) ? msg : `${jobs[i][0]}：${msg}`);
      }
    });
    return { products, errors };
  }

  async trialPrice(code: string, req: ShipmentRequest) {
    return this.pick(code).trialPrice(code, req);
  }

  /** 嘉谷的渠道合并报价；其他服务商的渠道不在返回里（照旧逐个报价） */
  trialPriceMany(codes: string[], req: ShipmentRequest) {
    const jgCodes = codes.filter((c) => isJiaguCode(c));
    return this.jg && jgCodes.length ? this.jg.trialPriceMany(jgCodes, req) : new Map<string, Promise<FeeQuote | null>>();
  }

  async createOrder(customNo: string, code: string, req: ShipmentRequest, remark?: string) {
    const c = this.pick(code);
    if (c === this.dhl) return this.dhl!.createOrder(customNo, code, req, remark);
    if (c === this.jg) {
      const name = (db().prepare("SELECT name FROM channels WHERE code = ?").get(code) as { name: string } | undefined)?.name;
      return this.jg!.createOrder(customNo, code, req, name ?? code);
    }
    return (c as ShipBestClient).createOrder(customNo, code, req, remark);
  }

  async getOrder(key: { orderNo?: string; customNo?: string }) {
    if (this.isDhlOrder(key)) return this.dhl!.getOrder(key.customNo!);
    if (this.isJgOrder(key)) return this.jg!.getOrder(key.customNo!);
    if (!this.sb) throw new ShipBestError(11202, "订单不存在");
    return this.sb.getOrder(key);
  }

  async cancelOrder(key: { orderNo?: string; customNo?: string }) {
    if (this.isDhlOrder(key)) return this.dhl!.cancelOrder(key.customNo!);
    if (this.isJgOrder(key)) return this.jg!.cancelOrder(key.customNo!);
    if (!this.sb) throw new ShipBestError(11202, "订单不存在");
    return this.sb.cancelOrder(key);
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
  // 模式以 env.json 为准（决定用正式还是测试数据）；老数据 / 单库运行时看设置和环境变量
  const stored = process.env.ATR_SINGLE_DB === "1" ? null : storedMode();
  const saved = stored ?? (sb.mode === "mock" || sb.mode === "sandbox" || sb.mode === "live" ? sb.mode : null);
  let mode: ShipBestMode = saved ?? (process.env.SHIPBEST_MOCK === "1" ? "mock" : "live");
  // 正式站：只能是正式模式（客户永远看不到测试数据，测试请到沙盒站）；还没填任何服务商账号时才用模拟，方便刚装好时试看
  if (process.env.APP_ENV === "production") mode = (apiId && token) || getSettings().jiagu?.enabled ? "live" : "mock";
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

/** 正式模式下 DHL 不报价、不出单时的说明（后台看得到；客户只看到“该渠道暂时无法报价”） */
export const DHL_TEST_ON_LIVE_MSG = "DHL 服务商账号还是测试环境：测试环境的面单不能真实寄件，正式模式下不报价、不出单。请到 设置 → DHL Express 填正式账号，环境选“正式”";

/**
 * 正式模式（不是沙盒站、不是模拟 / 沙盒模式）下，DHL 还设成测试环境：
 * 测试环境出的面单不能真实寄件，客户付了钱拿到的却是无效面单，所以这时 DHL 渠道不报价、不出单。
 */
export function dhlTestOnLive(): boolean {
  return shipbestConfig().mode === "live" && !!dhlConfig() && dhlSettings().mode !== "live";
}

let live: { key: string; jg: JiaguClient | null; client: ShipBestClient } | null = null;
let testWrap: { base: ShipBestClient; client: ShipBestClient } | null = null;

/**
 * 内部测试账号用的接口：报价照常取真实价格，下单 / 查询 / 取消全部模拟（不连服务商、不产生费用）。
 * 正式模式下包一层沙盒；本来就是模拟 / 沙盒模式时直接用。
 */
export function getTestAccountClient(): ShipBestClient {
  const base = getShipBestClient();
  if (shipbestConfig().mode !== "live") return base;
  // 测试账号的单全是模拟的：DHL 还在测试环境时也可以报价试用（正式客户那边照样不报价）
  if (testWrap?.base !== base) testWrap = { base, client: new SandboxShipBestClient(base instanceof MultiProviderClient ? base.withoutDhlGuard() : base) };
  return testWrap.client;
}

/** DHL 客户端（按配置缓存）；模拟模式下启用了 DHL 就用模拟的 DHL */
let dhlCache: { key: string; client: DhlClient } | null = null;
export function getDhlClient(mock = false): DhlClient | null {
  const cfg: DhlConfig | null = dhlConfig() ?? (mock && dhlSettings().enabled ? { apiKey: "mock", apiSecret: "mock", accountNumber: "mock", baseUrl: "mock://dhl", labelTemplate: "ECOM26_A6_002", paperless: true, originCountry: (dhlSettings().originCountry || "CN").toUpperCase() } : null);
  if (!cfg) return null;
  const isMock = mock || cfg.baseUrl.startsWith("mock://");
  const key = JSON.stringify([cfg, isMock]);
  if (dhlCache?.key !== key) {
    dhlCache = { key, client: new DhlClient(cfg, isMock ? mockDhlTransport((no, t, to) => mockLabelPdf(no, { channel: "DHL Express", tracking: t, to })) : undefined) };
  }
  return dhlCache.client;
}

/** 模拟模式：尾程用模拟 ShipBest，DHL 渠道（启用时）交给模拟 DHL；渠道名保持原样 */
class MockWithDhl implements ShipBestClient {
  constructor(private mock: MockShipBestClient, private dhl: DhlClient) {}
  private isDhl(key: { customNo?: string }) {
    return !!key.customNo && !!dhlOrders.get(key.customNo);
  }
  async verify() {}
  async getProducts() {
    return [...(await this.mock.getProducts()), ...(await this.dhl.getProducts())];
  }
  trialPrice(code: string, req: ShipmentRequest) {
    return isDhlCode(code) ? this.dhl.trialPrice(code, req) : this.mock.trialPrice(code, req);
  }
  createOrder(customNo: string, code: string, req: ShipmentRequest, remark?: string) {
    return isDhlCode(code) ? this.dhl.createOrder(customNo, code, req, remark) : this.mock.createOrder(customNo, code, req);
  }
  getOrder(key: { orderNo?: string; customNo?: string }) {
    return this.isDhl(key) ? this.dhl.getOrder(key.customNo!) : this.mock.getOrder(key);
  }
  cancelOrder(key: { orderNo?: string; customNo?: string }) {
    return this.isDhl(key) ? this.dhl.cancelOrder(key.customNo!) : this.mock.cancelOrder(key);
  }
}
let mockWithDhl: { dhl: DhlClient; client: MockWithDhl } | null = null;

export function getShipBestClient(): ShipBestClient {
  const c = shipbestConfig();
  if (c.mode === "mock") {
    const mock = (g.__shipbestMock ??= new MockShipBestClient());
    const dhl = getDhlClient(true);
    if (!dhl) return mock;
    if (mockWithDhl?.dhl !== dhl) mockWithDhl = { dhl, client: new MockWithDhl(mock, dhl) };
    return mockWithDhl.client;
  }
  const jg = getJiaguClient();
  const dhl = getDhlClient();
  const hasSb = !!(c.apiId && c.token);
  if (!hasSb && !jg && !dhl) {
    throw new Error("还没有填写 ShipBest API ID / Token，请到后台“设置 → ShipBest 连接”填写");
  }
  // 正式模式下 DHL 还是测试环境：DHL 渠道不报价、不出单（沙盒模式下单是模拟的，不用拦）
  const dhlTest = c.mode === "live" && !!dhl && dhlSettings().mode !== "live";
  const key = `${c.mode}|${c.baseUrl}|${c.apiId}|${c.token}|${jg ? "jg" : ""}|${dhl ? dhlCache?.key ?? "" : ""}|${dhlTest ? "dhl-test" : ""}`;
  if (live?.key !== key || live.jg !== jg) {
    const real = new MultiProviderClient(hasSb ? new HttpShipBestClient(c.baseUrl, c.apiId, c.token) : null, jg, dhl, { dhlTestOnLive: dhlTest });
    live = { key, jg, client: c.mode === "sandbox" ? new SandboxShipBestClient(real) : real };
  }
  return live.client;
}
