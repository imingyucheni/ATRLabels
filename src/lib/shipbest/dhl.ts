/**
 * DHL Express 官方账号（MyDHL API，REST，v3）：国际快递面单。
 * 文档：https://developer.dhl.com/api-reference/dhl-express-mydhl-api
 *
 * 和尾程服务商一样接进系统：渠道代码 DHL-<产品代码>（例如 DHL-P = Express Worldwide），
 * 报价走 POST /rates（一次请求拿到这条线路所有产品的价格，按渠道分发），
 * 出单走 POST /shipments（同步返回面单 PDF 和商业发票），面单和发票存在本地。
 * DHL 没有作废运单的接口：没被揽收（扫描）的运单不计费，所以“取消”是查一下轨迹，没揽收就在本地作废。
 */
import { db, getSettings } from "../db";
import { providerFetch, ShipBestError } from "./errors";
import type { Address, FeeQuote, OrderDetail, Product, ShipmentRequest, SkuItem } from "./types";

export const DHL_PREFIX = "DHL-";
export const DHL_SUFFIX = " · DHL";

/** 我们开放的 DHL 产品（美国出口、非文件类）；某条线路不提供的产品报价时会显示“该线路不提供” */
export const DHL_PRODUCTS: { code: string; name: string }[] = [
  { code: "P", name: "DHL Express Worldwide" },
  { code: "Y", name: "DHL Express 12:00" },
  { code: "E", name: "DHL Express 9:00" },
];

/** 面单模板：A6（约 4×6 英寸，普通 4×6 热敏纸能打）或 DHL 默认的 4×8 */
export const DHL_LABEL_TEMPLATES = { ECOM26_A6_002: "A6（4×6 热敏纸）", ECOM26_84_001: "4×8 热敏纸（DHL 默认）" } as const;
export type DhlLabelTemplate = keyof typeof DHL_LABEL_TEMPLATES;

export interface DhlSettings {
  enabled: boolean;
  /** test = DHL 测试环境（不会真实出单）；live = 正式 */
  mode: "test" | "live";
  apiKey: string;
  apiSecret: string;
  /** DHL 付款账号（Shipper account number） */
  accountNumber: string;
  labelTemplate?: DhlLabelTemplate;
  /** 电子发票（Paperless Trade）：DHL 电子传送商业发票，不用打印随货；目的地不支持时自动改成纸质发票 */
  paperless?: boolean;
  /** 商品原产国默认值（商品没填原产国时用） */
  originCountry?: string;
}

export const DEFAULT_DHL: DhlSettings = { enabled: false, mode: "test", apiKey: "", apiSecret: "", accountNumber: "", labelTemplate: "ECOM26_A6_002", paperless: true, originCountry: "CN" };

export interface DhlConfig {
  apiKey: string;
  apiSecret: string;
  accountNumber: string;
  baseUrl: string;
  labelTemplate: DhlLabelTemplate;
  paperless: boolean;
  originCountry: string;
}

export function dhlSettings(): DhlSettings {
  return { ...DEFAULT_DHL, ...(getSettings().dhl ?? {}) };
}

/** 启用并且账号填完整才返回配置 */
export function dhlConfig(): DhlConfig | null {
  const d = dhlSettings();
  if (!d.enabled || !d.apiKey || !d.apiSecret || !d.accountNumber) return null;
  return {
    apiKey: d.apiKey,
    apiSecret: d.apiSecret,
    accountNumber: d.accountNumber,
    baseUrl: d.mode === "live" ? "https://express.api.dhl.com/mydhlapi" : "https://express.api.dhl.com/mydhlapi/test",
    labelTemplate: d.labelTemplate && d.labelTemplate in DHL_LABEL_TEMPLATES ? d.labelTemplate : "ECOM26_A6_002",
    paperless: d.paperless !== false,
    originCountry: (d.originCountry || "CN").toUpperCase(),
  };
}

export function isDhlCode(code: string | null | undefined) {
  return !!code && code.startsWith(DHL_PREFIX);
}

/** 美国本土和属地（USPS 等按美国境内寄） */
const US_DOMESTIC = new Set(["US", "PR", "VI", "GU", "AS", "MP", "UM"]);

/** 国际件：收件国家不是美国（及属地） */
export function isInternational(req: Pick<ShipmentRequest, "recipient">) {
  return !!req.recipient?.country && !US_DOMESTIC.has(req.recipient.country.toUpperCase());
}

/** 错误统一带上“DHL”，后台能看出是哪家；客户端看到的是去掉内部信息后的说明 */
export class DhlError extends ShipBestError {
  constructor(code: string | number | null | undefined, message: string) {
    super(Number(code) || 1, /DHL/.test(message) ? message : `DHL：${message}`);
    this.name = "DhlError";
  }
}

/* ---------------- 单位换算 ---------------- */

const LB = 0.45359237;
const IN = 2.54;

/** 包裹重量换成 kg（向上取到 0.01） */
export function kgOf(weight: number, unit: number) {
  const kg = unit === 3 ? weight * LB : unit === 1 ? weight / 1000 : weight;
  return Math.max(0.01, Math.ceil(kg * 100 - 1e-9) / 100);
}

/** 尺寸换成 cm（向上取整，DHL 按整厘米算材积） */
export function cmOf(v: number, unit: number) {
  return Math.max(1, Math.ceil((unit === 3 ? v * IN : v) - 1e-9));
}

function cut(s: string | null | undefined, n: number) {
  return (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
}

function fullName(a: Address) {
  return [a.nameFirst, a.nameLast].filter(Boolean).join(" ").trim() || a.corporateName || "";
}

/* ---------------- 请求体 ---------------- */

/** 发货时间：美西时间，当天 15:00 前按当天 16:00，之后按下一个工作日 10:00（DHL 要求不能是过去的时间） */
export function plannedShipTime(now = new Date()): string {
  const tz = "America/Los_Angeles";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, weekday: "short" }).formatToParts(now).map((p) => [p.type, p.value]));
  let day = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  let hour = "16:00:00";
  const weekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
  if (Number(parts.hour) % 24 >= 15 || weekend(day)) {
    do day = new Date(day.getTime() + 86_400_000);
    while (weekend(day));
    hour = "10:00:00";
  }
  // 当天的时差（夏令时 -07:00，冬令时 -08:00）
  const probe = new Date(day.getTime() + 20 * 3_600_000);
  const offName = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(probe).find((p) => p.type === "timeZoneName")?.value ?? "GMT-08:00";
  return `${day.toISOString().slice(0, 10)}T${hour}${offName.replace("GMT", "GMT")}`;
}

function postalAddress(a: Address) {
  const country = (a.country || "US").toUpperCase();
  const prov = cut(a.province, 35);
  return {
    postalCode: cut(a.zipCode, 12),
    cityName: cut(a.city, 45),
    countryCode: country,
    ...(prov ? (/^[A-Za-z]{2,3}$/.test(prov) ? { provinceCode: prov.toUpperCase() } : { provinceName: prov }) : {}),
    addressLine1: cut(a.address1, 45),
    ...(a.address2?.trim() ? { addressLine2: cut(a.address2, 45) } : {}),
    ...(a.area?.trim() ? { countyName: cut(a.area, 45) } : {}),
  };
}

function party(a: Address, kind: "shipper" | "receiver") {
  const name = cut(fullName(a), 255);
  return {
    postalAddress: postalAddress(a),
    contactInformation: {
      phone: cut(a.phone, 70),
      companyName: cut(a.corporateName || name, 100),
      fullName: name,
      ...(a.email?.trim() ? { email: cut(a.email, 70) } : {}),
    },
    typeCode: kind === "shipper" || a.corporateName ? "business" : "private",
    ...(a.taxIdValue?.trim() ? { registrationNumbers: [{ typeCode: kind === "receiver" ? "SDT" : "EIN", number: cut(a.taxIdValue, 35), issuerCountryCode: (a.country || "US").toUpperCase() }] } : {}),
  };
}

function packageOf(req: ShipmentRequest, reference?: string) {
  const p = req.pkg;
  const u = p.displayUnitSystem;
  return {
    weight: kgOf(p.weight, u),
    dimensions: { length: cmOf(p.length, u), width: cmOf(p.width, u), height: cmOf(p.height, u) },
    ...(reference ? { customerReferences: [{ value: cut(reference, 35), typeCode: "CU" }] } : {}),
  };
}

const declared = (skus: SkuItem[]) => Math.round(skus.reduce((a, s) => a + s.declaredUnitPrice * s.quantity, 0) * 100) / 100;

/** HS 编码只留数字（DHL 要 6–10 位） */
export const hsDigits = (hs: string | null | undefined) => (hs ?? "").replace(/\D/g, "");

/**
 * 美国出口规定：同一个 HS 编码（Schedule B）申报价值超过 $2,500 要先做 AES 申报拿到 ITN。
 * 返回超过的 HS 编码（没有超过返回 null）。
 */
export function aesRequired(skus: SkuItem[]): string | null {
  const byHs = new Map<string, number>();
  for (const s of skus) {
    const k = hsDigits(s.hsCode).slice(0, 6) || `#${s.productNameEn}`;
    byHs.set(k, (byHs.get(k) ?? 0) + s.declaredUnitPrice * s.quantity);
  }
  for (const [k, v] of byHs) if (v > 2500) return k.startsWith("#") ? k.slice(1) : k;
  return null;
}

/** 每一行商品的净重 / 毛重（kg）：没填单件重量的按包裹重量按数量平摊 */
function lineWeights(req: ShipmentRequest): number[] {
  const total = kgOf(req.pkg.weight, req.pkg.displayUnitSystem);
  const qty = req.skuList.reduce((a, s) => a + (s.quantity || 1), 0) || 1;
  return req.skuList.map((s) => {
    const w = s.weight > 0 ? kgOf(s.weight, s.unit || req.pkg.displayUnitSystem) * (s.quantity || 1) : (total * (s.quantity || 1)) / qty;
    return Math.max(0.01, Math.round(Math.min(w, total) * 100) / 100);
  });
}

export function buildRatesBody(cfg: DhlConfig, req: ShipmentRequest, codes?: string[]) {
  const p = req.pkg;
  return {
    customerDetails: { shipperDetails: postalAddress(req.sender), receiverDetails: postalAddress(req.recipient) },
    accounts: [{ typeCode: "shipper", number: cfg.accountNumber }],
    plannedShippingDateAndTime: plannedShipTime(),
    unitOfMeasurement: "metric",
    isCustomsDeclarable: true,
    monetaryAmount: [{ typeCode: "declaredValue", value: Math.max(1, declared(req.skuList)), currency: "USD" }],
    nextBusinessDay: true,
    packages: [packageOf(req)],
    // 买保险时按指定产品 + 保险服务报价（价格里含保险费）
    ...(p.insuranceService && Number(p.insuranceFee) > 0 && codes?.length
      ? { productsAndServices: codes.map((c) => ({ productCode: c, valueAddedServices: [{ serviceCode: "II", value: Number(p.insuranceFee), currency: "USD" }] })) }
      : {}),
  };
}

export function buildShipmentBody(cfg: DhlConfig, productCode: string, req: ShipmentRequest, opts: { customNo: string; reference?: string; paperless: boolean }) {
  const skus = req.skuList;
  const weights = lineWeights(req);
  const value = declared(skus);
  const p = req.pkg;
  const vas: Record<string, unknown>[] = [];
  if (opts.paperless) vas.push({ serviceCode: "WY" });
  if (p.insuranceService && Number(p.insuranceFee) > 0) vas.push({ serviceCode: "II", value: Number(p.insuranceFee), currency: "USD" });
  const description = cut(skus.map((s) => s.productNameEn).filter(Boolean).join(", ") || "Merchandise", 70);
  const usExport = (req.sender.country || "US").toUpperCase() === "US";
  return {
    plannedShippingDateAndTime: plannedShipTime(),
    pickup: { isRequested: false },
    productCode,
    accounts: [{ typeCode: "shipper", number: cfg.accountNumber }],
    ...(vas.length ? { valueAddedServices: vas } : {}),
    outputImageProperties: {
      encodingFormat: "pdf",
      imageOptions: [
        { typeCode: "label", templateName: cfg.labelTemplate },
        { typeCode: "invoice", isRequested: true, invoiceType: "commercial", templateName: "COMMERCIAL_INVOICE_P_10" },
        { typeCode: "waybillDoc", isRequested: false },
      ],
    },
    customerReferences: [{ value: cut(opts.reference || opts.customNo, 35), typeCode: "CU" }],
    customerDetails: { shipperDetails: party(req.sender, "shipper"), receiverDetails: party(req.recipient, "receiver") },
    content: {
      packages: [packageOf(req, opts.customNo)],
      isCustomsDeclarable: true,
      declaredValue: Math.max(0.01, value),
      declaredValueCurrency: "USD",
      exportDeclaration: {
        lineItems: skus.map((s, i) => {
          const hs = hsDigits(s.hsCode);
          return {
            number: i + 1,
            // 商业发票上的品名：英文品名 + 材质，例如 “Cotton T-shirt (100% cotton)”
            description: cut(`${s.productNameEn || s.productNameCn || "Merchandise"}${s.material?.trim() ? ` (${s.material.trim()})` : ""}`, 512),
            price: Math.round(s.declaredUnitPrice * 100) / 100,
            quantity: { value: Math.max(1, Math.round(s.quantity)), unitOfMeasurement: "PCS" },
            ...(hs ? { commodityCodes: [{ typeCode: "outbound", value: hs.slice(0, 10) }] } : {}),
            exportReasonType: "permanent",
            manufacturerCountry: (s.originCountry || cfg.originCountry).toUpperCase().slice(0, 2),
            weight: { netValue: weights[i], grossValue: weights[i] },
          };
        }),
        invoice: { number: cut(opts.customNo, 35), date: plannedShipTime().slice(0, 10), function: "both" },
      },
      description,
      incoterm: "DAP",
      unitOfMeasurement: "metric",
      // 美国出口、每个 HS 编码都不超过 $2,500：免 AES 申报（面单上印 NO EEI 30.37(a)）
      ...(usExport && !aesRequired(skus) ? { USFilingTypeValue: "30.37(a)" } : {}),
    },
  };
}

/* ---------------- 本地订单记录 ---------------- */

type DhlOrder = {
  customNo: string;
  productCode: string;
  trackingNo: string;
  trackingUrl?: string | null;
  status: number;
  label?: string | null;
  labelFormat?: string | null;
  invoice?: string | null;
  paperless: boolean;
  cost?: number | null;
  error?: string | null;
};

export const dhlOrders = {
  conn() {
    const c = db();
    c.exec("CREATE TABLE IF NOT EXISTS provider_orders (custom_no TEXT PRIMARY KEY, provider TEXT NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
    return c;
  },
  get(customNo: string): DhlOrder | undefined {
    const r = this.conn().prepare("SELECT json FROM provider_orders WHERE custom_no = ? AND provider = 'dhl'").get(customNo) as { json: string } | undefined;
    return r ? JSON.parse(r.json) : undefined;
  },
  save(o: DhlOrder) {
    this.conn()
      .prepare("INSERT INTO provider_orders (custom_no, provider, json) VALUES (?, 'dhl', ?) ON CONFLICT(custom_no) DO UPDATE SET json = excluded.json")
      .run(o.customNo, JSON.stringify(o));
  },
};

/** 面单地址：dhl://<自定义单号>（面单内容在本地记录里，downloadLabel 读出来存成文件） */
export const dhlLabelUrl = (customNo: string) => `dhl://${customNo}`;

export function dhlLabelBytes(customNo: string): Buffer | null {
  const o = dhlOrders.get(customNo);
  return o?.label ? Buffer.from(o.label, "base64") : null;
}

/** 面单页显示用：有没有商业发票、是不是电子发票 */
export function dhlDocInfo(customNo: string): { hasInvoice: boolean; paperless: boolean } | null {
  const o = dhlOrders.get(customNo);
  return o ? { hasInvoice: !!o.invoice, paperless: o.paperless } : null;
}

export function dhlInvoiceBytes(customNo: string): Buffer | null {
  const o = dhlOrders.get(customNo);
  return o?.invoice ? Buffer.from(o.invoice, "base64") : null;
}

/* ---------------- 接口 ---------------- */

/** 发请求的函数（测试 / 模拟模式可以换成假的） */
export type DhlTransport = (method: "GET" | "POST", path: string, body?: unknown) => Promise<{ status: number; json: unknown }>;

function httpTransport(cfg: DhlConfig): DhlTransport {
  const auth = "Basic " + Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString("base64");
  return async (method, path, body) => {
    const { res, text } = await providerFetch("DHL", cfg.baseUrl + path, {
      method,
      headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json", "x-version": "3.3.1" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      timeoutMs: method === "POST" && path.startsWith("/shipments") ? 60_000 : 25_000,
    });
    try {
      return { status: res.status, json: text ? JSON.parse(text) : {} };
    } catch {
      // 网关超时等返回的不是 JSON：结果未知（不能当作 DHL 明确拒绝）
      throw new Error(`DHL 接口返回异常（HTTP ${res.status}）${text.slice(0, 120)}`);
    }
  };
}

/** DHL 的错误返回：{ title, detail, status, additionalDetails[] } */
export function dhlErrorMessage(j: unknown, status: number): string {
  const e = (j ?? {}) as { title?: string; detail?: string; message?: string; additionalDetails?: string[] };
  const extra = (e.additionalDetails ?? []).filter(Boolean).join("；");
  return [e.detail || e.message || e.title || `HTTP ${status}`, extra].filter(Boolean).join("：").slice(0, 600);
}

type RateProduct = { productCode: string; productName?: string; totalPrice?: { currencyType?: string; priceCurrency?: string; price?: number }[]; deliveryCapabilities?: { totalTransitDays?: number | string; estimatedDeliveryDateAndTime?: string } };

export class DhlClient {
  private transport: DhlTransport;
  /** 同一个包裹几个 DHL 渠道一起报价时只请求一次 /rates */
  private rateMemo = new Map<string, { at: number; p: Promise<RateProduct[]> }>();

  constructor(private cfg: DhlConfig, transport?: DhlTransport) {
    this.transport = transport ?? httpTransport(cfg);
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const r = await this.transport(method, path, body);
    if (r.status >= 200 && r.status < 300) return r.json as T;
    throw new DhlError(r.status, dhlErrorMessage(r.json, r.status));
  }

  /** 测试连接：用自己的发货地址到伦敦报一次价 */
  async verify() {
    const s = getSettings().sender;
    await this.call("POST", "/rates", {
      ...buildRatesBody(this.cfg, {
        sender: s?.zipCode ? s : ({ nameFirst: "Test", nameLast: "Shipper", country: "US", city: "Los Angeles", zipCode: "90058", address1: "1 Main St" } as Address),
        recipient: { nameFirst: "Test", nameLast: "Receiver", country: "GB", city: "London", zipCode: "SW1A 1AA", address1: "10 Downing St" },
        pkg: { length: 10, width: 8, height: 4, weight: 1, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
        skuList: [],
      }),
    });
  }

  async getProducts(): Promise<Product[]> {
    return DHL_PRODUCTS.map((p) => ({ code: `${DHL_PREFIX}${p.code}`, name: `${p.name}${DHL_SUFFIX}` }));
  }

  private rates(req: ShipmentRequest): Promise<RateProduct[]> {
    const key = JSON.stringify([req.sender.zipCode, req.sender.country, req.recipient.zipCode, req.recipient.city, req.recipient.country, req.pkg, declared(req.skuList)]);
    const hit = this.rateMemo.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.p;
    const codes = DHL_PRODUCTS.map((p) => p.code);
    const p = this.call<{ products?: RateProduct[] }>("POST", "/rates", buildRatesBody(this.cfg, req, codes)).then((r) => r.products ?? []);
    this.rateMemo.set(key, { at: Date.now(), p });
    p.catch(() => this.rateMemo.delete(key));
    if (this.rateMemo.size > 200) for (const [k, v] of this.rateMemo) if (Date.now() - v.at > 60_000) this.rateMemo.delete(k);
    return p;
  }

  async trialPrice(code: string, req: ShipmentRequest): Promise<FeeQuote | null> {
    if (!isInternational(req)) throw new DhlError(1, "DHL 国际快递只寄往美国以外的国家");
    const productCode = code.slice(DHL_PREFIX.length);
    let products: RateProduct[];
    try {
      products = await this.rates(req);
    } catch (e) {
      // 这条线路完全没有可用产品（例如邮编不对、目的地不服务）
      if (e instanceof DhlError && /no product|not available|unavailable|no rate/i.test(e.message)) throw new DhlError(1, `该线路 DHL 不提供服务（不在派送范围）：${e.message}`);
      throw e;
    }
    const p = products.find((x) => x.productCode === productCode);
    if (!p) throw new DhlError(1, `该线路 DHL 不提供 ${DHL_PRODUCTS.find((x) => x.code === productCode)?.name ?? productCode}`);
    const price = p.totalPrice?.find((t) => t.currencyType === "BILLC") ?? p.totalPrice?.[0];
    const total = Number(price?.price);
    if (!(total > 0)) throw new DhlError(1, "DHL 没有返回价格");
    const days = Number(p.deliveryCapabilities?.totalTransitDays);
    return {
      logisticsProductId: 0,
      logisticsProductName: p.productName || code,
      baseShippingFee: total,
      baseDiscountShippingFee: total,
      extraShippingFee: 0,
      extraDiscountShippingFee: 0,
      totalShippingFee: total,
      totalDiscountShippingFee: total,
      currency: price?.priceCurrency || "USD",
      zone: days > 0 ? `${days} 个工作日` : null,
    };
  }

  async createOrder(customNo: string, code: string, req: ShipmentRequest, _remark?: string) {
    const productCode = code.slice(DHL_PREFIX.length);
    // 面单上的客户参考号印客户的订单号（没有就印我们的系统单号）
    const reference = (db().prepare("SELECT customer_ref FROM shipments WHERE custom_no = ?").get(customNo) as { customer_ref: string | null } | undefined)?.customer_ref || customNo;
    type Resp = { shipmentTrackingNumber?: string; trackingUrl?: string; documents?: { typeCode?: string; imageFormat?: string; content?: string }[]; shipmentCharges?: { currencyType?: string; price?: number }[] };
    let paperless = this.cfg.paperless;
    let r: Resp;
    try {
      r = await this.call<Resp>("POST", "/shipments", buildShipmentBody(this.cfg, productCode, req, { customNo, reference, paperless }));
    } catch (e) {
      // 目的地不支持电子发票：改成纸质发票再提交一次（客户需要打印商业发票随货）
      if (!(paperless && e instanceof DhlError && /\bWY\b|paperless|PLT/i.test(e.message))) throw e;
      paperless = false;
      r = await this.call<Resp>("POST", "/shipments", buildShipmentBody(this.cfg, productCode, req, { customNo, reference, paperless }));
    }
    if (!r.shipmentTrackingNumber) throw new DhlError(1, "DHL 没有返回运单号");
    const label = r.documents?.find((d) => d.typeCode === "label");
    const invoice = r.documents?.find((d) => d.typeCode === "invoice");
    const charge = r.shipmentCharges?.find((c) => c.currencyType === "BILLC") ?? r.shipmentCharges?.[0];
    dhlOrders.save({
      customNo,
      productCode: code,
      trackingNo: r.shipmentTrackingNumber,
      trackingUrl: r.trackingUrl ?? null,
      status: label?.content ? 4 : 3,
      label: label?.content ?? null,
      labelFormat: label?.imageFormat ?? null,
      invoice: invoice?.content ?? null,
      paperless,
      cost: Number(charge?.price) > 0 ? Number(charge?.price) : null,
      error: label?.content ? null : "DHL 没有返回面单",
    });
    return { trackingNo: r.shipmentTrackingNumber };
  }

  async getOrder(customNo: string): Promise<OrderDetail> {
    const o = dhlOrders.get(customNo);
    if (!o) throw new DhlError(1, "订单不存在");
    return {
      // 不填服务商单号：查询 / 取消都按我们的自定义单号找到这票 DHL
      orderNo: "",
      customNo,
      logisticsProductCode: o.productCode,
      logisticsProductName: o.productCode,
      status: o.status,
      errorMsg: o.error ?? null,
      trackingNo: o.trackingNo,
      labelUrl: o.label ? dhlLabelUrl(customNo) : null,
      feePrice: o.cost ?? null,
      feePriceCurrency: o.cost ? "USD" : null,
    };
  }

  /** 查轨迹：返回事件代码（PU = 已揽收 …）；还没有任何扫描时返回空数组 */
  async trackingEvents(trackingNo: string): Promise<string[]> {
    try {
      const r = await this.call<{ shipments?: { events?: { typeCode?: string; description?: string }[] }[] }>("GET", `/shipments/${encodeURIComponent(trackingNo)}/tracking?trackingView=all-checkpoints&levelOfDetail=all`);
      return (r.shipments?.[0]?.events ?? []).map((e) => e.typeCode || e.description || "").filter(Boolean);
    } catch (e) {
      // 404：还没有任何轨迹（没揽收）
      if (e instanceof DhlError && e.code === 404) return [];
      throw e;
    }
  }

  /** DHL 没有作废接口：没揽收的运单不计费，查一下轨迹，没有揽收就在本地作废 */
  async cancelOrder(customNo: string) {
    const o = dhlOrders.get(customNo);
    if (!o) throw new DhlError(1, "订单不存在");
    if (o.status === 6) return;
    const events = await this.trackingEvents(o.trackingNo);
    // 只有“运单信息已接收”之类的电子记录不算揽收；出现揽收或之后的扫描就不能取消
    if (events.some((t) => !/^(SD|SI|MR|IR|SIR)$/i.test(t))) throw new DhlError(2, "DHL 已经揽收这票包裹，不能取消（请联系客服）");
    dhlOrders.save({ ...o, status: 6 });
  }
}

/* ---------------- 模拟（演示 / 测试） ---------------- */

/** 模拟 DHL：按重量和目的地估一个价，面单是模拟 PDF */
export function mockDhlTransport(makeLabel: (customNo: string, tracking: string, to: string[]) => Buffer): DhlTransport {
  let seq = 0;
  return async (method, path, body) => {
    const b = (body ?? {}) as Record<string, any>;
    if (method === "POST" && path === "/rates") {
      const kg = Number(b.packages?.[0]?.weight) || 1;
      const to = String(b.customerDetails?.receiverDetails?.countryCode || "GB");
      const far = /^(AU|NZ|ZA|BR|AR|CL|IN|SA|AE)$/.test(to) ? 1.35 : /^(CA|MX)$/.test(to) ? 0.8 : 1;
      const base = (38 + kg * 9.5) * far;
      const products = DHL_PRODUCTS.map((p, i) => ({
        productCode: p.code,
        productName: p.name.replace(/^DHL /, "").toUpperCase(),
        totalPrice: [{ currencyType: "BILLC", priceCurrency: "USD", price: Math.round(base * [1, 1.25, 1.45][i] * 100) / 100 }],
        deliveryCapabilities: { totalTransitDays: [3, 2, 2][i] },
      }));
      return { status: 200, json: { products } };
    }
    if (method === "POST" && path === "/shipments") {
      const tracking = String(1000000000 + ++seq * 7919 + (Date.now() % 100000)).slice(0, 10);
      const r = b.customerDetails?.receiverDetails;
      const to = [r?.contactInformation?.fullName, r?.postalAddress?.addressLine1, `${r?.postalAddress?.cityName ?? ""} ${r?.postalAddress?.postalCode ?? ""} ${r?.postalAddress?.countryCode ?? ""}`].filter(Boolean);
      const customNo = String(b.content?.packages?.[0]?.customerReferences?.[0]?.value ?? tracking);
      const pdf = makeLabel(customNo, tracking, to).toString("base64");
      return {
        status: 201,
        json: {
          shipmentTrackingNumber: tracking,
          trackingUrl: `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${tracking}`,
          documents: [{ typeCode: "label", imageFormat: "PDF", content: pdf }, { typeCode: "invoice", imageFormat: "PDF", content: pdf }],
        },
      };
    }
    if (method === "GET" && path.includes("/tracking")) return { status: 404, json: { title: "Not Found", detail: "No shipment found", status: "404" } };
    return { status: 404, json: { detail: `mock: ${method} ${path}` } };
  };
}
