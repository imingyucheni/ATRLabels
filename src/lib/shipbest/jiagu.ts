/**
 * 嘉谷万邑（Dragon Open API）尾程面单：和 ShipBest 并列的第二个服务商。
 * 渠道代码统一加前缀 JG-（例如 JG-580914），渠道名后面加“· 嘉谷”，只有后台看得到；客户看到的是物流商名称。
 * 文档：https://www.showdoc.com.cn/IOTEasy/8005120408974400 （尾程订单 OrderType = 20120）
 *
 * 注意：对方的授权服务只认 http 地址签发的令牌（https 拿到的令牌接口会拒绝），接口本身也只有 http。
 */
import { db, getSettings } from "../db";
import { ShipBestError } from "./errors";
import type { FeeQuote, OrderDetail, Product, ShipmentRequest } from "./types";

export const JG_PREFIX = "JG-";
export const JG_SUFFIX = " · 嘉谷";
const ORDER_TYPE_LASTMILE = 20120;

/** 嘉谷给的“产品 ID → 仓库 ID”（不同渠道从不同仓库出）；后台可以改，这里是默认值 */
export const DEFAULT_JG_WAREHOUSES: Record<string, string> = {
  "569599": "221121", // Fedex NG末端-N · GDE-ONE-91761
  "579181": "196845", // GOFO-LAX-917(不预上网) · GALAX
  "582718": "196845", // GOFO-H-LAX-917 · GALAX
  "590297": "229615", // UPS-D-GROUND-923 · CA-92374
  "307699": "196845", // uniuni-LAX-917(不预上网) · GALAX
  "581808": "196845", // Swiftx-LAX-917 · GALAX
  "580914": "196845", // USPS-D价-GA-917不预上网 · GALAX
};

export interface JiaguConfig {
  clientId: string;
  secret: string;
  ownershipId: number;
  customerId: number;
  /** 没有单独设置仓库的产品用这个 */
  warehouseId: number;
  /** 产品 ID → 仓库 ID */
  warehouses: Record<string, number>;
  authUrl: string;
  apiUrl: string;
}

export function jiaguConfig(): JiaguConfig | null {
  const j = getSettings().jiagu;
  if (!j?.enabled || !j.clientId || !j.secret || !j.ownershipId || !j.customerId) return null;
  return {
    clientId: j.clientId,
    secret: j.secret,
    ownershipId: Number(j.ownershipId),
    customerId: Number(j.customerId),
    warehouseId: Number(j.warehouseId) || 0,
    warehouses: Object.fromEntries(
      Object.entries({ ...DEFAULT_JG_WAREHOUSES, ...(j.warehouses ?? {}) })
        .map(([k, v]) => [k, Number(v)] as const)
        .filter(([, v]) => v > 0),
    ),
    authUrl: (j.authUrl || "http://authorization.iot-easy.cn").replace(/\/+$/, ""),
    apiUrl: (j.apiUrl || "http://dragon.iot-easy.cn").replace(/\/+$/, ""),
  };
}

export function isJiaguCode(code: string | null | undefined) {
  return !!code && code.startsWith(JG_PREFIX);
}

/* ---------------- 请求体 ---------------- */

function cut(s: string | null | undefined, n: number) {
  return (s ?? "").trim().slice(0, n);
}

function fullName(a: { nameFirst: string; nameLast: string; corporateName?: string }) {
  return [a.nameFirst, a.nameLast].filter(Boolean).join(" ").trim() || a.corporateName || "";
}

/** 包裹单位：g/cm → KG/CM，kg/cm → KG/CM，lb/in → LB/IN */
function units(req: ShipmentRequest) {
  const u = req.pkg.displayUnitSystem;
  const weight = u === 1 ? req.pkg.weight / 1000 : req.pkg.weight;
  return { weight: Math.round(weight * 1000) / 1000, weightUnit: u === 3 ? "LB" : "KG", lengthUnit: u === 3 ? "IN" : "CM" };
}

/** 签名服务：成人签名 → 10，直接 / 间接签名 → 20，不需要 → "" */
function signService(t: number) {
  return t === 3 ? "10" : t === 1 || t === 2 ? "20" : "";
}

/** 这个产品从哪个仓库出 */
export function warehouseFor(cfg: JiaguConfig, productId: number) {
  return cfg.warehouses[String(productId)] || cfg.warehouseId;
}

export function buildJiaguBody(cfg: JiaguConfig, req: ShipmentRequest, productId: number) {
  const { sender: s, recipient: r, pkg } = req;
  const u = units(req);
  const declared = req.skuList.reduce((a, i) => a + i.declaredUnitPrice * i.quantity, 0);
  const qty = req.skuList.reduce((a, i) => a + i.quantity, 0) || 1;
  const first = req.skuList[0];
  // 收件人电话是必填：没有时用寄件人电话
  const phone = cut(r.phone || s.phone || "", 20);
  return {
    CustomerID: cfg.customerId,
    WarehouseID: warehouseFor(cfg, productId),
    OwnershipID: cfg.ownershipId,
    OrderType: ORDER_TYPE_LASTMILE,
    NeedSignService: signService(pkg.signServiceType),
    ShipperName: cut(s.corporateName || fullName(s), 35),
    ShipperPhone: cut(s.phone, 20),
    ShipperAddress1: cut([s.address1, s.address2].filter(Boolean).join(" "), 35),
    ShipperCity: cut(s.city, 50),
    ShipperStateProvince: cut(s.province, 50),
    ShipperPostalCode: cut(s.zipCode, 10),
    ShipperCountry: cut(s.country || "US", 2),
    ShipToName: cut(fullName(r), 35),
    ShipToCompany: cut(r.corporateName, 35),
    ShipToEmail: cut(r.email, 50),
    ShipToPhone: phone,
    ShipToAddress1: cut(r.address1, 35),
    ShipToAddress2: cut(r.address2, 35),
    ShipToCity: cut(r.city, 50),
    ShipToStateProvince: cut(r.province, 50),
    ShipToPostalCode: cut(r.zipCode, 10),
    ShipToCountry: cut(r.country || "US", 2),
    IsBuyInsurance: pkg.insuranceService ? 1 : 0,
    IsReturn: 0,
    Packages: [
      {
        PackageIdentifier: "P1",
        Length: pkg.length,
        Width: pkg.width,
        Height: pkg.height,
        Weight: u.weight,
        LengthUnit: u.lengthUnit,
        WeightUnit: u.weightUnit,
        Qty: qty,
        // 申报价值必须大于 0
        DeclareValue: Math.max(0.01, Math.round((declared / qty) * 100) / 100) || 1,
        // SKU 不支持中文，会被替换成 *，只传英文数字
        ...(first?.sku && /^[\x20-\x7e]+$/.test(first.sku) ? { SKU: cut(first.sku, 64) } : {}),
        ...(first?.productNameEn ? { DeclareEnName: cut(first.productNameEn, 50) } : {}),
      },
    ],
  };
}

/* ---------------- 接口 ---------------- */

interface JgResult<T> {
  IsSuccess?: boolean;
  isSuccess?: boolean;
  ErrorCode?: string | null;
  errorCode?: string | null;
  Message?: string | null;
  message?: string | null;
  Result?: T;
  result?: T;
}

/** 错误信息统一带上“嘉谷”，后台能看出是哪个服务商；客户端会过滤掉服务商字样 */
export class JiaguError extends ShipBestError {
  constructor(code: string | number | null | undefined, message: string) {
    super(Number(code) || 1, message.includes("嘉谷") ? message : `嘉谷：${message}`);
    this.name = "JiaguError";
  }
}

type LocalOrder = { customNo: string; productCode: string; productName: string; identifier?: string; trackingNo?: string | null; labelUrl?: string | null; status: number; cost?: number | null; error?: string | null };

/** 嘉谷订单在本地的记录：查状态 / 取消时知道是嘉谷的单 */
export const jgOrders = {
  conn() {
    const c = db();
    c.exec("CREATE TABLE IF NOT EXISTS provider_orders (custom_no TEXT PRIMARY KEY, provider TEXT NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
    return c;
  },
  get(customNo: string): LocalOrder | undefined {
    const r = this.conn().prepare("SELECT json FROM provider_orders WHERE custom_no = ? AND provider = 'jiagu'").get(customNo) as { json: string } | undefined;
    return r ? JSON.parse(r.json) : undefined;
  },
  save(o: LocalOrder) {
    this.conn()
      .prepare("INSERT INTO provider_orders (custom_no, provider, json) VALUES (?, 'jiagu', ?) ON CONFLICT(custom_no) DO UPDATE SET json = excluded.json")
      .run(o.customNo, JSON.stringify(o));
  },
};

export class JiaguClient {
  private token: { value: string; exp: number } | null = null;
  constructor(private cfg: JiaguConfig) {}

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.exp) return this.token.value;
    const res = await fetch(`${this.cfg.authUrl}/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.cfg.clientId, client_secret: this.cfg.secret }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!json.access_token) throw new JiaguError(res.status, `授权失败（检查 Client ID / Secret）${json.error ? `：${json.error}` : ""}`);
    // 提前 5 分钟换新令牌
    this.token = { value: json.access_token, exp: Date.now() + Math.max(60, (json.expires_in ?? 3600) - 300) * 1000 };
    return json.access_token;
  }

  private async call<T>(path: string, body: unknown, retry = true): Promise<{ ok: boolean; code: string | null; message: string; result: T | undefined }> {
    const res = await fetch(`${this.cfg.apiUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await this.accessToken()}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    });
    if (res.status === 401 && retry) {
      this.token = null;
      return this.call(path, body, false);
    }
    const text = await res.text();
    let j: JgResult<T>;
    try {
      j = JSON.parse(text);
    } catch {
      throw new JiaguError(res.status, `接口返回异常（HTTP ${res.status}）${text.slice(0, 120)}`);
    }
    return {
      ok: !!(j.IsSuccess ?? j.isSuccess),
      code: (j.ErrorCode ?? j.errorCode ?? null) || null,
      message: (j.Message ?? j.message ?? "") || "",
      result: j.Result ?? j.result,
    };
  }

  async verify() {
    await this.getProducts();
  }

  async getProducts(): Promise<Product[]> {
    const r = await this.call<{ ID: number; ProductName: string }[]>("/api/gts/ListProductSubscribe", { ownershipID: this.cfg.ownershipId, customerID: this.cfg.customerId });
    if (!r.ok) throw new JiaguError(r.code, r.message || "获取渠道失败");
    return (r.result ?? []).map((p) => ({ code: `${JG_PREFIX}${p.ID}`, name: `${p.ProductName}${JG_SUFFIX}` }));
  }

  async trialPrice(code: string, req: ShipmentRequest): Promise<FeeQuote | null> {
    const id = Number(code.slice(JG_PREFIX.length));
    const r = await this.call<{ ID: number; ProductName: string | null; TotalCharge: number; Message: string | null; RatesList: { Currency: string; ZoneCode: string; Amount: number }[] | null }[]>(
      "/api/gts/CalculateRates",
      { ...buildJiaguBody(this.cfg, req, id), Products: [{ ID: id }] },
    );
    if (!r.ok) throw new JiaguError(r.code, r.message || "算价失败");
    const q = (r.result ?? []).find((x) => x.ID === id) ?? r.result?.[0];
    if (!q) return null;
    if (!warehouseFor(this.cfg, id)) throw new JiaguError(10061, `渠道 ${id} 还没有设置仓库 ID（设置 → 嘉谷万邑）`);
    if (!q.TotalCharge || q.Message) {
      const msg = q.Message || "算价失败";
      // 分区匹配不到 = 这个邮编不在派送范围，按“不通邮”处理（和 ShipBest 一致，客户端显示“地址未覆盖”）
      if (/分区/.test(msg)) throw new JiaguError(1, `邮编[${req.recipient.zipCode}]不通邮（${msg}）`);
      throw new JiaguError(10061, msg);
    }
    // 总价和明细合计偶尔差 1 分（例如 5.56 / 5.57），取较高的作为成本，避免少收
    const lines = (q.RatesList ?? []).reduce((a, x) => a + (Number(x.Amount) || 0), 0);
    const total = Math.round(Math.max(q.TotalCharge, lines) * 100) / 100;
    const zone = q.RatesList?.find((x) => x.ZoneCode)?.ZoneCode;
    return {
      logisticsProductId: id,
      logisticsProductName: q.ProductName || code,
      baseShippingFee: total,
      baseDiscountShippingFee: total,
      extraShippingFee: 0,
      extraDiscountShippingFee: 0,
      totalShippingFee: total,
      totalDiscountShippingFee: total,
      currency: q.RatesList?.[0]?.Currency || "USD",
      zone: zone ? `zone${zone}` : null,
    };
  }

  async createOrder(customNo: string, code: string, req: ShipmentRequest, productName = code) {
    const id = Number(code.slice(JG_PREFIX.length));
    const r = await this.call<{ Identifier?: string; MasterTrackingNbr?: string; TrackingNbr?: string; MasterLabelUrl?: string; labels?: { labelUri?: string }[] }>(
      "/api/gts/ShippingLabel",
      { ...buildJiaguBody(this.cfg, req, id), OrderNbr: customNo, ProductID: id },
    );
    // ErrorCode = 100：订单已建，服务商面单稍后返回，之后查状态时再取
    if (!r.ok && r.code !== "100") throw new JiaguError(r.code, r.message || "下单失败");
    const x = r.result ?? {};
    const tracking = x.MasterTrackingNbr || x.TrackingNbr || null;
    const label = x.MasterLabelUrl || x.labels?.[0]?.labelUri || null;
    jgOrders.save({ customNo, productCode: code, productName, identifier: x.Identifier, trackingNo: tracking, labelUrl: label, status: tracking && label ? 4 : 2 });
  }

  async getOrder(customNo: string): Promise<OrderDetail> {
    const o = jgOrders.get(customNo);
    if (!o) throw new JiaguError(900901, "订单在嘉谷系统中不存在");
    if (o.status === 2) {
      // 面单还没好：先按订单号取，取不到再用异步面单接口
      const r = await this.call<{ TrackingNbr?: string; WaybillUrl?: string }>("/api/gts/GetMailNoByOrderNbr", {
        ownerShipID: this.cfg.ownershipId, customerID: this.cfg.customerId, orderNbr: customNo, waybillFormat: "PDF",
      });
      let tracking = r.ok ? r.result?.TrackingNbr : undefined;
      let label = r.ok ? r.result?.WaybillUrl : undefined;
      if (!tracking || !label) {
        const a = await this.call<{ mailNo?: string; labelUrl?: string }>("/api/gts/GetLabelAsync", { ownershipID: this.cfg.ownershipId, customerID: this.cfg.customerId, orderNbr: customNo });
        if (a.ok) {
          tracking = tracking || a.result?.mailNo;
          label = label || a.result?.labelUrl;
        }
      }
      if (tracking && label) {
        Object.assign(o, { trackingNo: tracking, labelUrl: label, status: 4 });
        jgOrders.save(o);
      }
    }
    return {
      // 不回填 orderNo：本地一律按自定义单号查嘉谷订单（嘉谷单号记在 provider_orders 里）
      orderNo: "",
      customNo,
      logisticsProductCode: o.productCode,
      logisticsProductName: o.productName,
      status: o.status,
      trackingNo: o.trackingNo ?? null,
      labelUrl: o.labelUrl ?? null,
      errorMsg: o.error ?? null,
      feePrice: null,
      feePriceCurrency: null,
    };
  }

  async cancelOrder(customNo: string) {
    const o = jgOrders.get(customNo);
    const pid = o ? Number(o.productCode.slice(JG_PREFIX.length)) : 0;
    const r = await this.call<boolean>("/api/gts/VoidShipment", {
      ownershipID: this.cfg.ownershipId, warehouseID: warehouseFor(this.cfg, pid), customerID: this.cfg.customerId, orderNbr: customNo,
    });
    if (!r.ok || r.result === false) throw new JiaguError(r.code ?? 11203, r.message || "该订单不支持取消");
    if (o) jgOrders.save({ ...o, status: 6 });
  }

  /** 实际结算费用（出单后服务商核算的金额），用于自动补差 */
  async orderCharge(customNo: string): Promise<{ total: number; weight: number } | null> {
    const r = await this.call<{ totalCharge?: number; totalWeight?: number }>("/api/gts/OrderCharge", { ownershipID: this.cfg.ownershipId, customerID: this.cfg.customerId, orderNbr: customNo });
    if (!r.ok || !r.result?.totalCharge) return null;
    return { total: Number(r.result.totalCharge), weight: Number(r.result.totalWeight ?? 0) };
  }

  /** 在嘉谷的账户余额（美元） */
  async balance(): Promise<{ usd: number; credit: number; type: string } | null> {
    const r = await this.call<{ TypeName?: string; Details?: { Currency: string; Balance: number; CreditLimit: number }[] }[]>("/api/gts/SearchBalance", {
      ownershipID: this.cfg.ownershipId, customerID: this.cfg.customerId,
    });
    if (!r.ok) throw new JiaguError(r.code, r.message || "查询余额失败");
    const acct = r.result?.[0];
    const usd = acct?.Details?.find((d) => d.Currency === "USD");
    return usd ? { usd: usd.Balance, credit: usd.CreditLimit, type: acct?.TypeName ?? "" } : null;
  }
}

let cached: { key: string; client: JiaguClient } | null = null;

/** 嘉谷接口（没配置或没启用时返回 null） */
export function getJiaguClient(): JiaguClient | null {
  const cfg = jiaguConfig();
  if (!cfg) return null;
  const key = JSON.stringify(cfg);
  if (cached?.key !== key) cached = { key, client: new JiaguClient(cfg) };
  return cached.client;
}
