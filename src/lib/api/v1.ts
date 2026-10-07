/**
 * 开放 API v1：客户（或客户的 ERP / OMS，例如领星）用 API 密钥报价、出单、取面单、查状态、取消。
 * 规则和网页下单完全一样（加价、限时活动、余额、地址核对、取消时限），只是换成 JSON 进出。
 * 字段名尽量用 ERP 对接物流商时常见的叫法：referenceNo（客户单号）、orderNo（我们的单号）、trackingNo。
 */
import { db, getCustomer, getShipment, listChannels, customerChannels, getSettings, type Shipment } from "../db";
import type { Address, ShipmentRequest, SkuItem, UnitSystem } from "../shipbest/types";
import { cleanRequest } from "../sanitize";
import { createLabel, quoteAll, quoteChannel, refreshShipment, requestCancel, validateRequest, PriceChangedError, API_TEST_ENV } from "../service";
import { publicQuoteError, cancelWindowPassed, cancelWindowHours } from "../portal";
import { displayChannel } from "../channelDisplay";
import { trackingUrl } from "../carriers";
import { balanceOf, InsufficientBalanceError } from "../ledger";
import { checkAddress, needsAck, type AddressCheck } from "../addressCheck";
import { hasAcceptedTerms } from "../terms";
import { senderFor } from "../batch";
import { isDhlCode } from "../shipbest/dhl";
import { readLabel } from "../labels";
import { stampedLabel } from "../stamp";
import type { ApiKey } from "./keys";
import { isMultiBoxName } from "../multiBox";

/** 接口错误：code 给程序判断，message 给人看 */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

/* ---------------- 请求格式 ---------------- */

export interface ApiAddress {
  name?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  phone?: string;
  email?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface ApiPackage {
  length?: number;
  width?: number;
  height?: number;
  weight?: number;
  /** in/lb（默认）、cm/kg、cm/g */
  unit?: string;
  /** none（默认）、direct、indirect、adult */
  signature?: string;
}

export interface ApiItem {
  sku?: string;
  name?: string;
  nameCn?: string;
  quantity?: number;
  /** 单件申报价值（USD） */
  unitValue?: number;
  hsCode?: string;
  originCountry?: string;
  material?: string;
}

export interface ApiShipmentBody {
  shipFrom?: ApiAddress;
  shipTo?: ApiAddress;
  package?: ApiPackage;
  items?: ApiItem[];
}

const UNITS: Record<string, UnitSystem> = { "in/lb": 3, "lb/in": 3, imperial: 3, "cm/kg": 2, "kg/cm": 2, metric: 2, "cm/g": 1, "g/cm": 1 };
const SIGN: Record<string, 0 | 1 | 2 | 3> = { none: 0, direct: 1, indirect: 2, adult: 3 };

function toAddress(a: ApiAddress | undefined, label: string, errors: string[]): Partial<Address> {
  if (!a || typeof a !== "object") {
    errors.push(`${label} 必填`);
    return {};
  }
  let first = String(a.firstName ?? "").trim();
  let last = String(a.lastName ?? "").trim();
  if (!first && !last && a.name) {
    const parts = String(a.name).trim().split(/\s+/);
    first = parts[0] ?? "";
    last = parts.slice(1).join(" ");
  }
  // 只有一个名字（例如公司件）：姓也用它，服务商两个字段都要有值
  if (first && !last) last = first;
  return {
    nameFirst: first, nameLast: last, corporateName: a.company, phone: a.phone, email: a.email,
    address1: a.address1, address2: a.address2, city: a.city, province: a.state, zipCode: a.postalCode, country: (a.country || "US").toUpperCase(),
  };
}

/** 把 API 的 JSON 变成内部的下单请求；字段不对时抛 VALIDATION_ERROR（一次列出全部问题） */
export function toShipmentRequest(customerId: number, body: ApiShipmentBody): ShipmentRequest {
  const errors: string[] = [];
  const recipient = toAddress(body.shipTo, "shipTo", errors);
  const sender = body.shipFrom ? toAddress(body.shipFrom, "shipFrom", errors) : senderFor(customerId);
  if (!sender) errors.push("shipFrom 必填（账户里也没有默认寄件地址）");
  const p = body.package;
  if (!p || typeof p !== "object") errors.push("package 必填");
  const unit = UNITS[String(p?.unit ?? "in/lb").toLowerCase()];
  if (!unit) errors.push("package.unit 只能是 in/lb、cm/kg 或 cm/g");
  const sig = SIGN[String(p?.signature ?? "none").toLowerCase()];
  if (sig === undefined) errors.push("package.signature 只能是 none、direct、indirect 或 adult");
  const u = unit ?? 3;
  const items: ApiItem[] = Array.isArray(body.items) ? body.items : [];  // 美国件不传时 cleanRequest 会补一件普通货物
  if (items.length > 50) errors.push("items 最多 50 个");
  if (errors.length) throw new ApiError(400, "VALIDATION_ERROR", errors.join("；"), { errors });
  const qty = items.reduce((a, i) => a + (Number(i.quantity) || 1), 0) || 1;
  const w = Number(p!.weight) || 0;
  const skuList: Partial<SkuItem>[] = items.map((i) => ({
    sku: String(i.sku ?? "").trim() || String(i.name ?? "ITEM").slice(0, 40),
    productNameCn: String(i.nameCn ?? ""),
    productNameEn: String(i.name ?? i.sku ?? "Merchandise"),
    quantity: Number(i.quantity) || 1,
    declaredUnitPrice: Number(i.unitValue) || 1,
    declaredCurrency: "USD",
    hsCode: String(i.hsCode ?? ""),
    productNature: "2,4",
    ...(i.originCountry ? { originCountry: String(i.originCountry).toUpperCase() } : {}),
    ...(i.material ? { material: String(i.material) } : {}),
    length: Number(p!.length) || 0, width: Number(p!.width) || 0, height: Number(p!.height) || 0,
    weight: Math.round((w / qty) * 1000) / 1000, unit: u,
  }));
  const req = cleanRequest({
    sender: sender as Address,
    recipient: recipient as Address,
    pkg: { length: Number(p!.length), width: Number(p!.width), height: Number(p!.height), weight: w, displayUnitSystem: u, signServiceType: sig, insuranceService: 0, currency: "USD" },
    skuList: skuList as SkuItem[],
  });
  const problems = validateRequest(req);
  if (problems.length) throw new ApiError(400, "VALIDATION_ERROR", problems.join("；"), { errors: problems });
  return req;
}

/* ---------------- 输出格式 ---------------- */

const STATUS: Record<string, string> = { pending: "processing", labeled: "labeled", cancel_requested: "cancelling", cancelled: "cancelled", exception: "exception" };

export function orderView(s: Shipment, base: string) {
  const ch = displayChannel(s.channelCode);
  const labelReady = !!s.labelPath && s.status !== "cancelled";
  return {
    orderNo: s.customNo,
    referenceNo: s.customerRef,
    status: STATUS[s.status] ?? s.status,
    channel: s.channelCode,
    channelName: ch.name || s.channelName,
    carrier: ch.carrier,
    trackingNo: s.trackingNo,
    trackingUrl: s.trackingNo ? trackingUrl(ch.carrier, s.trackingNo) : null,
    price: s.price,
    currency: s.currency,
    zone: s.zone,
    labelReady,
    labelUrl: labelReady ? `${base}/api/v1/orders/${encodeURIComponent(s.customNo)}/label` : null,
    test: s.env === API_TEST_ENV,
    createdAt: s.createdAt,
    ...(s.status === "cancelled" ? { refund: s.refundAmount ?? 0, cancelFee: s.cancelFee ?? 0 } : {}),
    ...(s.status === "exception" && s.errorMsg ? { error: s.errorMsg } : {}),
  };
}

/* ---------------- 接口 ---------------- */

/** GET /channels：这个账户能用的渠道（名称是客户看到的名称） */
export function channels(key: ApiKey) {
  const enabled = new Set(listChannels(true).map((c) => c.code));
  return customerChannels(key.customerId)
    // 多箱渠道接口还不支持（一票多箱）
    .filter((c) => enabled.has(c.code) && !isMultiBoxName(c.name))
    .map((c) => {
      const d = displayChannel(c.code);
      return { channel: c.code, name: d.name || c.name, carrier: d.carrier, international: isDhlCode(c.code) };
    });
}

/** GET /balance */
export function balance(key: ApiKey) {
  const c = getCustomer(key.customerId)!;
  return { balance: Math.round(balanceOf(key.customerId) * 100) / 100, creditLimit: c.creditLimit ?? 0, currency: "USD" };
}

/** POST /rates：所有渠道（或指定渠道）的报价，按价格从低到高 */
export async function rates(key: ApiKey, body: ApiShipmentBody & { channel?: string }) {
  const req = toShipmentRequest(key.customerId, body);
  const list = body.channel ? [await quoteChannel(key.customerId, String(body.channel), req)] : await quoteAll(key.customerId, req).catch((e) => {
    throw new ApiError(400, "NO_CHANNEL", (e as Error).message);
  });
  return list.map((q) => ({
    channel: q.channelCode,
    name: displayChannel(q.channelCode).name || q.channelName,
    carrier: displayChannel(q.channelCode).carrier,
    available: q.ok,
    ...(q.ok ? { price: q.price, currency: q.currency, zone: q.zone ?? null } : { error: publicQuoteError(q.error) }),
    ...(q.warning ? { warning: q.warning } : {}),
    ...(q.promo ? { promo: { name: q.promo.label, endsOn: q.promo.endsOn, originalPrice: q.promo.originalPrice } } : {}),
  }));
}

function findOrder(customerId: number, no: string): Shipment | null {
  const r = db()
    .prepare("SELECT id FROM shipments WHERE customer_id = ? AND (custom_no = ? OR customer_ref = ?) ORDER BY (custom_no = ?) DESC, id DESC LIMIT 1")
    .get(customerId, no, no, no) as { id: number } | undefined;
  return r ? getShipment(r.id) : null;
}

/** 测试密钥只能看到测试单，正式密钥只能看到正式单 */
function visible(key: ApiKey, s: Shipment | null): Shipment {
  if (!s || (key.mode === "test") !== (s.env === API_TEST_ENV)) throw new ApiError(404, "NOT_FOUND", "订单不存在");
  return s;
}

export interface CreateBody extends ApiShipmentBody {
  referenceNo?: string;
  channel?: string;
  /** 报价时看到的价格；填了的话价格变了会拒绝（PRICE_CHANGED），不填按当前价格出单 */
  expectedPrice?: number;
  remark?: string;
  /** 地址核对提示地址可能有问题时，确认地址无误继续出单 */
  addressConfirmed?: boolean;
}

/**
 * POST /orders：出单。同一个 referenceNo 重复提交（例如网络超时重试）直接返回已有的单，不会重复扣费。
 */
export async function createOrder(key: ApiKey, body: CreateBody, base: string) {
  const ref = String(body.referenceNo ?? "").trim().slice(0, 50);
  if (!ref) throw new ApiError(400, "VALIDATION_ERROR", "referenceNo 必填（你们系统里的订单号，用来防止重复出单）");
  const channel = String(body.channel ?? "").trim();
  if (!channel) throw new ApiError(400, "VALIDATION_ERROR", "channel 必填（先调 /channels 或 /rates 拿渠道代码）");
  const existing = findOrder(key.customerId, ref);
  if (existing && existing.customerRef === ref && existing.status !== "cancelled" && existing.status !== "exception" && (key.mode === "test") === (existing.env === API_TEST_ENV)) {
    return { created: false, order: orderView(existing, base) };
  }
  if (key.mode === "live" && !hasAcceptedTerms(key.customerId)) throw new ApiError(403, "TERMS_NOT_ACCEPTED", "请先登录客户中心阅读并同意服务条款");
  if (!customerChannels(key.customerId).some((c) => c.code === channel)) throw new ApiError(400, "CHANNEL_UNAVAILABLE", "这个账户没有开通该渠道");
  const req = toShipmentRequest(key.customerId, body);

  // 地址核对：查不到 / 缺公寓号时要确认过才出单（和网页一样）
  const address = await checkAddress(req.recipient);
  if (needsAck(address) && !body.addressConfirmed) {
    throw new ApiError(422, "ADDRESS_CHECK", address.message || "收件地址可能有问题，请检查；确认无误后加 addressConfirmed: true 重新提交", { address });
  }
  let expected = Number(body.expectedPrice);
  if (!Number.isFinite(expected) || expected <= 0) {
    const q = await quoteChannel(key.customerId, channel, req);
    if (!q.ok) throw new ApiError(400, "CHANNEL_UNAVAILABLE", publicQuoteError(q.error));
    expected = q.price!;
  }
  try {
    const id = await createLabel({
      customerId: key.customerId,
      channelCode: channel,
      req,
      expectedPrice: expected,
      customerRef: ref,
      remark: body.remark ? String(body.remark).slice(0, 200) : undefined,
      createdBy: "customer",
      addressCheck: needsAck(address) ? ({ ...address, acknowledged: true } as AddressCheck) : address,
      simulate: key.mode === "test",
    });
    return { created: true, order: orderView(getShipment(id)!, base) };
  } catch (e) {
    if (e instanceof PriceChangedError) throw new ApiError(409, "PRICE_CHANGED", e.message, { price: e.quote.price, currency: e.quote.currency });
    if (e instanceof InsufficientBalanceError) throw new ApiError(402, "INSUFFICIENT_BALANCE", e.message);
    throw new ApiError(400, "ORDER_FAILED", (e as Error).message);
  }
}

/** GET /orders/{no}：查单（还在出面单的会顺便去服务商刷新一次） */
export async function getOrder(key: ApiKey, no: string, base: string) {
  let s = visible(key, findOrder(key.customerId, no));
  if (s.status === "pending" || (s.status === "labeled" && !s.trackingNo)) s = await refreshShipment(s.id).catch(() => s);
  return orderView(s, base);
}

/** GET /orders/{no}/label：面单文件 */
export async function getLabel(key: ApiKey, no: string): Promise<{ bytes: Uint8Array; mime: string; filename: string }> {
  let s = visible(key, findOrder(key.customerId, no));
  if (!s.labelPath && s.status === "pending") s = await refreshShipment(s.id).catch(() => s);
  if (s.status === "cancelled") throw new ApiError(410, "LABEL_VOID", "这张面单已取消作废，不能再打印");
  if (!s.labelPath) throw new ApiError(404, "LABEL_NOT_READY", "面单还在生成，请稍后再取");
  const stamped = await stampedLabel(s);
  const bytes = stamped ?? readLabel(s.labelPath);
  const mime = stamped ? "application/pdf" : s.labelMime || "application/pdf";
  const ext = mime === "application/pdf" ? "pdf" : mime.split("/")[1] ?? "bin";
  return { bytes, mime, filename: `${(s.trackingNo || s.customNo).replace(/[^\w.-]+/g, "_")}.${ext}` };
}

/** POST /orders/{no}/cancel：取消（规则和客户中心一样：时限内、接口能取消的马上退款，否则转人工） */
export async function cancelOrder(key: ApiKey, no: string, base: string) {
  const s = visible(key, findOrder(key.customerId, no));
  if (s.status === "cancelled") return { done: true, message: "已经是取消状态", order: orderView(s, base) };
  if (s.status !== "pending" && s.status !== "labeled") throw new ApiError(409, "CANCEL_NOT_ALLOWED", "这张面单当前不能取消");
  if (cancelWindowPassed(s.createdAt)) throw new ApiError(409, "CANCEL_NOT_ALLOWED", `下单已超过 ${cancelWindowHours()} 小时，不能再取消`);
  const r = await requestCancel(s.id).catch((e) => {
    throw new ApiError(502, "PROVIDER_ERROR", (e as Error).message);
  });
  const contact = getSettings().supportContact;
  return {
    done: r.done,
    message: r.done ? (s.env === API_TEST_ENV ? "已取消（测试单，没有扣费）" : "已取消，费用已退回账户余额") : `已提交取消申请，处理完成后费用退回账户余额${contact ? `（客服：${contact}）` : ""}`,
    order: orderView(getShipment(s.id)!, base),
  };
}
