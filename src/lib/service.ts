import { randomBytes } from "node:crypto";
import {
  db,
  customerCanUse,
  customerChannels,
  getChannel,
  getCustomer,
  getSettings,
  getShipment,
  insertShipment,
  deleteShipment,
  listChannels,
  updateShipment,
  upsertChannels,
  type Shipment,
  type ShipmentPatch,
  activeShipmentByRef,
  isInternalCustomer,
  duplicateRefMessage,
} from "./db";
import { precheck, rememberQuote } from "./coverage";
import { downloadLabel, readLabel } from "./labels";
import { backfillLabelSku, detectLabelSku } from "./labelSku";
import { chargeLabel, refundCancelled, removeShipmentLedger } from "./ledger";
import { displayChannel } from "./channelDisplay";
import { notifyLater } from "./notify";
import type { AddressCheck } from "./addressCheck";
import { computePrice, resolveRule, roundUp, type MarkupRule, type PartialRule } from "./pricing";
import { getShipBestClient, shipbestMode, ShipBestError } from "./shipbest/client";
import { isJiaguCode } from "./shipbest/jiagu";
import { guessCarrier } from "./carriers";
import { publicError } from "./portal";
import { logProviderEvent } from "./providerLog";
import { SB_STATUS } from "./shipbest/types";
import type { Address, ShipmentRequest } from "./shipbest/types";
import { isCountryCode, isUsZip, usStateCode } from "./geo";
import { fillProductNames } from "./sanitize";

/* ---------------- 校验 ---------------- */

function checkAddress(a: Address | undefined, who: string, errors: string[], zipRequired: boolean) {
  if (!a) {
    errors.push(`${who}信息必填`);
    return;
  }
  const req: [keyof Address, string][] = [
    ["nameFirst", "名"],
    ["nameLast", "姓"],
    ["country", "国家二字码"],
    ["city", "城市"],
    ["address1", "地址1"],
  ];
  if (zipRequired) req.push(["zipCode", "邮编"]);
  for (const [k, label] of req) if (!a[k]?.toString().trim()) errors.push(`${who}${label}必填`);
  if (a.country && !/^[A-Za-z]{2}$/.test(a.country)) errors.push(`${who}国家请填二字码，例如 US`);
  else if (a.country && !isCountryCode(a.country)) errors.push(`${who}国家代码“${a.country}”不存在，请从下拉框选择`);
  if (a.country?.toUpperCase() === "US") {
    if (!a.province?.trim()) errors.push(`${who}州必填`);
    else if (!usStateCode(a.province)) errors.push(`${who}州“${a.province}”不正确，请从下拉框选择（例如 CA、TX）`);
    if (a.zipCode && !isUsZip(a.zipCode)) errors.push(`${who}邮编“${a.zipCode}”格式不对，美国邮编是 5 位数字（可以带 4 位，例如 78701-1234）`);
  }
  const max: [keyof Address, number, string][] = [
    ["nameFirst", 50, "名"],
    ["nameLast", 50, "姓"],
    ["phone", 50, "电话"],
    ["email", 50, "邮箱"],
    ["province", 50, "省/州"],
    ["city", 50, "城市"],
    ["area", 50, "区/县"],
    ["zipCode", 50, "邮编"],
    ["corporateName", 50, "公司"],
    ["taxIdValue", 50, "税号"],
    ["houseNumber", 50, "门牌号"],
    ["street", 100, "街道"],
    ["address1", 100, "地址1"],
    ["address2", 100, "地址2"],
  ];
  for (const [k, n, label] of max) if ((a[k]?.toString().length ?? 0) > n) errors.push(`${who}${label}最多 ${n} 个字符`);
}

export interface ValidateOptions {
  /** 只试算运费（不出单）：不检查商品明细，试算前用 withQuoteSkus 补一个样品 */
  forQuote?: boolean;
}

export function validateRequest(req: ShipmentRequest, opts: ValidateOptions = {}): string[] {
  const errors: string[] = [];
  checkAddress(req.sender, "寄件人", errors, true);
  checkAddress(req.recipient, "收件人", errors, true);
  const p = req.pkg;
  for (const [k, label] of [
    ["length", "长"],
    ["width", "宽"],
    ["height", "高"],
    ["weight", "重量"],
  ] as const) {
    if (!(p[k] > 0)) errors.push(`包裹${label}必须大于 0`);
  }
  if (p.insuranceService && !(Number(p.insuranceFee) > 0)) errors.push("需要保险时保险金额必须大于 0");
  if (opts.forQuote) return errors;
  if (!req.skuList.length) errors.push("至少需要一个商品明细");
  req.skuList.forEach((s, i) => {
    const n = `商品 ${i + 1}：`;
    if (!s.sku) errors.push(n + "SKU 必填");
    // 中文品名可以不填（英文客户）：清洗时会用英文品名补上，见 sanitize.ts fillProductNames
    if (!s.productNameEn) errors.push(n + "英文品名必填");
    if (!s.productNature) errors.push(n + "商品性质必填");
    if (!(s.quantity > 0)) errors.push(n + "数量必须大于 0");
    if (!(s.declaredUnitPrice > 0)) errors.push(n + "申报单价必须大于 0");
  });
  return errors;
}

/** 试算用的样品商品（试算接口要求至少一个 SKU，但运费只看地址和包裹） */
export const SAMPLE_SKU = { sku: "SAMPLE", productNameCn: "样品", productNameEn: "Sample", quantity: 1, declaredUnitPrice: 1, productNature: "2,4" } as const;

/**
 * 只试算时补全商品明细：完全没填的行去掉；填了一部分的行把缺的字段用样品值补上；
 * 一行都没有时加一个样品。只用于试算，出单仍然要完整的商品明细。
 */
export function withQuoteSkus(req: ShipmentRequest): ShipmentRequest {
  const p = req.pkg;
  const filled = req.skuList
    .filter((s) => s.sku || s.productNameCn || s.productNameEn || s.declaredUnitPrice > 0)
    .map((s) => ({
      ...s,
      sku: s.sku || SAMPLE_SKU.sku,
      productNameCn: s.productNameCn || s.productNameEn || SAMPLE_SKU.productNameCn,
      productNameEn: s.productNameEn || SAMPLE_SKU.productNameEn,
      quantity: s.quantity > 0 ? s.quantity : 1,
      declaredUnitPrice: s.declaredUnitPrice > 0 ? s.declaredUnitPrice : SAMPLE_SKU.declaredUnitPrice,
      productNature: s.productNature || SAMPLE_SKU.productNature,
      length: s.length || p.length,
      width: s.width || p.width,
      height: s.height || p.height,
      weight: s.weight || p.weight,
    }));
  if (filled.length) return { ...req, skuList: filled };
  return {
    ...req,
    skuList: [
      {
        ...SAMPLE_SKU,
        declaredCurrency: p.currency || "USD",
        hsCode: "",
        length: p.length,
        width: p.width,
        height: p.height,
        weight: p.weight,
        unit: p.displayUnitSystem,
      },
    ],
  };
}

/* ---------------- 渠道同步 ---------------- */

export async function syncChannels() {
  const products = await getShipBestClient().getProducts();
  upsertChannels(products);
  return products.length;
}

/* ---------------- 报价 ---------------- */

export interface ChannelQuote {
  channelCode: string;
  channelName: string;
  ok: boolean;
  error?: string;
  cost?: number;
  /** 未优惠前的总运费（仅供参考） */
  listCost?: number;
  currency?: string;
  zone?: string | null;
  /** 服务商没返回分区，按同一目的地其他渠道的分区补上的（仅供参考） */
  zoneEstimated?: boolean;
  rule?: MarkupRule;
  price?: number;
  profit?: number;
}

function ruleFor(customerId: number, channelCode: string): MarkupRule {
  // 公司自用账户：成本价，不加价
  if (isInternalCustomer(customerId)) return { percent: 0, fixed: 0, minProfit: 0 };
  const s = getSettings();
  return resolveRule(s.markup, getChannel(channelCode)?.markup, getCustomer(customerId)?.markup);
}

/* ---------------- 分区 ---------------- */

/**
 * 嘉谷大部分渠道的报价不返回分区。所有渠道都从洛杉矶地区发货，同一个目的地的分区基本一致，
 * 所以记住其他渠道（ShipBest）最近报出的分区，缺分区时拿来补上，并标记为“参考”。
 */
const zoneByZip = new Map<string, { zone: string; at: number }>();
const ZONE_TTL = 6 * 3600_000;

export function zoneOf(code: string, zip: string | undefined, zone: string | null | undefined): { zone: string | null; zoneEstimated?: boolean } {
  const z5 = (zip ?? "").trim().slice(0, 5);
  if (zone) {
    if (z5 && !isJiaguCode(code)) {
      if (zoneByZip.size > 5000) zoneByZip.clear();
      zoneByZip.set(z5, { zone, at: Date.now() });
    }
    return { zone };
  }
  const hit = z5 ? zoneByZip.get(z5) : undefined;
  return hit && Date.now() - hit.at < ZONE_TTL ? { zone: hit.zone, zoneEstimated: true } : { zone: null };
}

/** 一次比价的结果里，缺分区的用同一目的地其他渠道的分区补上 */
export function fillZones(results: ChannelQuote[]) {
  const known = results.find((r) => r.ok && r.zone && !r.zoneEstimated && !isJiaguCode(r.channelCode))?.zone;
  if (!known) return results;
  for (const r of results) if (r.ok && !r.zone) Object.assign(r, { zone: known, zoneEstimated: true });
  return results;
}

/**
 * 同一家承运商（例如 UniUni）不管走 ShipBest 还是嘉谷，派送范围应该一样。
 * 嘉谷说送不到、但 ShipBest 同承运商渠道能送时，在后台提示可能是嘉谷那边的分区表 / 仓库设置问题。
 */
export function flagJiaguCoverage(results: ChannelQuote[]) {
  const okCarriers = new Set(results.filter((r) => r.ok && !isJiaguCode(r.channelCode)).map((r) => guessCarrier(r.channelName)));
  for (const r of results) {
    if (r.ok || !isJiaguCode(r.channelCode) || !/派送范围|不通邮/.test(r.error ?? "")) continue;
    const carrier = guessCarrier(r.channelName);
    if (carrier !== "other" && okCarriers.has(carrier)) r.error = `${r.error}；ShipBest 同承运商渠道能送这个邮编，可能是嘉谷的分区表或仓库设置问题，建议找嘉谷核对`;
  }
  return results;
}

/** 指定渠道试算（渠道名从本地渠道表取） */
export async function quoteChannel(customerId: number, channelCode: string, req: ShipmentRequest): Promise<ChannelQuote> {
  const ch = getChannel(channelCode);
  if (!customerCanUse(customerId, channelCode)) {
    return { channelCode, channelName: ch?.name ?? channelCode, ok: false, error: "该客户未开通此渠道" };
  }
  return quoteOne(customerId, channelCode, ch?.name ?? channelCode, req);
}

async function quoteOne(customerId: number, channelCode: string, channelName: string, req: ShipmentRequest, rule?: MarkupRule) {
  // 最近查过“不通邮”的邮编（或打开了邮编表预筛）直接判定送不到，不再调接口
  const zip = req.recipient?.zipCode ?? "";
  const pre = precheck(channelCode, zip);
  if (pre) return { channelCode, channelName, ok: false, error: pre } satisfies ChannelQuote;
  const res = await quoteRemote(customerId, channelCode, channelName, req, rule);
  rememberQuote(channelCode, zip, res.ok, res.error);
  return res;
}

async function quoteRemote(customerId: number, channelCode: string, channelName: string, req: ShipmentRequest, ruleOverride?: MarkupRule): Promise<ChannelQuote> {
  const client = getShipBestClient();
  const { roundingStep } = getSettings();
  try {
    const q = await client.trialPrice(channelCode, req);
    if (!q) return { channelCode, channelName, ok: false, error: "该渠道无报价" } satisfies ChannelQuote;
    // 以“优惠后总运费”作为我们的成本
    const cost = q.totalDiscountShippingFee || q.totalShippingFee;
    const rule = ruleOverride ?? ruleFor(customerId, channelCode);
    // 公司自用账户按成本价：不做价格取整
    const price = computePrice(cost, rule, isInternalCustomer(customerId) ? 0.01 : roundingStep);
    return {
      channelCode,
      // 用我们渠道表里的名称（带“· SB / · GDE”服务商标记）；嘉谷的报价接口不返回产品名
      channelName: getChannel(channelCode)?.name || q.logisticsProductName || channelName,
      ok: true,
      cost,
      listCost: q.totalShippingFee,
      currency: q.currency,
      ...zoneOf(channelCode, req.recipient?.zipCode, q.zone),
      rule,
      price,
      profit: Math.round((price - cost) * 100) / 100,
    } satisfies ChannelQuote;
  } catch (e) {
    return { channelCode, channelName, ok: false, error: (e as Error).message } satisfies ChannelQuote;
  }
}

/**
 * 对这个客户已开通（且全局启用）的渠道逐个试算。
 * 注：试算接口只返回渠道 id 和名称、不返回 code，所以按 code 逐个请求，保证下单时 code 对得上。
 */
export async function quoteAll(customerId: number, req: ShipmentRequest): Promise<ChannelQuote[]> {
  if (!listChannels(true).length) throw new Error("没有启用的物流渠道，请先到“设置”里同步渠道");
  const channels = customerChannels(customerId);
  if (!channels.length) throw new NoChannelsError();
  const results: ChannelQuote[] = [];
  // 小并发，避免触发频率限制（11005）
  const queue = [...channels];
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      results.push(await quoteOne(customerId, c.code, c.name, req));
    }
  });
  await Promise.all(workers);
  return flagJiaguCoverage(fillZones(results)).sort((a, b) => Number(b.ok) - Number(a.ok) || (a.price ?? 0) - (b.price ?? 0));
}

/** 客户还没有开通任何渠道（门户里提示“请联系客服开通”） */
export class NoChannelsError extends Error {
  constructor() {
    super("该客户还没有开通任何物流渠道，请到客户详情里开通");
  }
}

/**
 * 销售试算（后台用，不出单）：还没开户的新客户，用所有已启用的渠道、按临时填写的加价试算，
 * 方便给新客户报价、比较渠道和加价幅度。
 */
export async function quoteForProspect(req: ShipmentRequest, markup: PartialRule): Promise<ChannelQuote[]> {
  const channels = listChannels(true);
  if (!channels.length) throw new Error("没有启用的物流渠道，请先到“设置”里同步渠道");
  const g = getSettings().markup;
  const results: ChannelQuote[] = [];
  const queue = [...channels];
  await Promise.all(
    Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        results.push(await quoteOne(0, c.code, c.name, req, resolveRule(g, c.markup, markup)));
      }
    }),
  );
  return flagJiaguCoverage(fillZones(results)).sort((a, b) => Number(b.ok) - Number(a.ok) || (a.price ?? 0) - (b.price ?? 0));
}

/* ---------------- 下单出面单 ---------------- */

export class PriceChangedError extends Error {
  constructor(public quote: ChannelQuote) {
    super(`价格已变化：当前报价 ${quote.price?.toFixed(2)} ${quote.currency}，请确认后重新提交`);
  }
}

function newCustomNo() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `ATR${ymd}${randomBytes(4).toString("hex").toUpperCase()}`;
}

export interface CreateInput {
  customerId: number;
  channelCode: string;
  req: ShipmentRequest;
  /** 页面上展示给员工的报价，用于防止价格在确认期间变化 */
  expectedPrice: number;
  remark?: string;
  /** 客户自己的订单号 */
  customerRef?: string;
  /** 谁下的单：admin / customer */
  createdBy?: "admin" | "customer";
  /** 下单后是否等待面单生成（批量下单时关闭，最后统一刷新） */
  waitForLabel?: boolean;
  /** 收件地址核对结果（客户确认过的问题地址也会记下来） */
  addressCheck?: AddressCheck | null;
}

export async function createLabel(input: CreateInput): Promise<number> {
  const { customerId, channelCode } = input;
  const req: ShipmentRequest = { ...input.req, skuList: input.req.skuList.map(fillProductNames) };
  if (!getCustomer(customerId)) throw new Error("客户不存在");
  const ref = input.customerRef?.trim() || "";
  // 同一个订单号不能重复下单（取消后可以重新下）
  const dupe = ref ? activeShipmentByRef(customerId, ref) : undefined;
  if (dupe) throw new Error(duplicateRefMessage(ref, dupe));
  const errors = validateRequest(req);
  if (errors.length) throw new Error(errors.join("；"));

  const channel = getChannel(channelCode);
  if (!channel?.enabled) throw new Error("渠道不存在或已停用");
  if (!customerCanUse(customerId, channelCode)) throw new Error("该客户未开通此渠道");

  // 下单前重新试算一次，价格有变化则让员工确认
  const quote = await quoteOne(customerId, channelCode, channel.name, req);
  if (!quote.ok) throw new Error(quote.error);
  if (Math.abs((quote.price ?? 0) - input.expectedPrice) > 0.005) throw new PriceChangedError(quote);

  const customNo = newCustomNo();
  const createdBy = input.createdBy ?? "admin";
  // 建本地记录和扣款放在同一个事务里：余额不足时什么都不留下
  const id = db().transaction(() => {
    // 试算期间可能已经有同号的单提交了（重复点击 / 两个页面同时下单），入库前再查一次
    const again = ref ? activeShipmentByRef(customerId, ref) : undefined;
    if (again) throw new Error(duplicateRefMessage(ref, again));
    const newId = insertShipment({
    customNo,
    customerId,
    channelCode,
    channelName: quote.channelName,
    sender: req.sender,
    recipient: req.recipient,
    pkg: req.pkg,
    skuList: req.skuList,
    quotedCost: quote.cost!,
    currency: quote.currency!,
    zone: quote.zone ?? null,
    price: quote.price!,
    rule: quote.rule!,
    remark: input.remark || null,
    customerRef: ref || null,
    createdBy,
    env: shipbestMode(),
    addressCheck: input.addressCheck && input.addressCheck.status !== "unavailable" && input.addressCheck.status !== "skipped" ? JSON.stringify(input.addressCheck) : null,
    });
    chargeLabel(customerId, newId, quote.price!, createdBy, `运费 · ${displayChannel(channelCode).name || quote.channelName}${quote.zone ? ` · ${quote.zone}` : ""}`);
    return newId;
  })();

  try {
    await getShipBestClient().createOrder(customNo, channelCode, req, input.remark);
    if (!isJiaguCode(channelCode)) logProviderEvent(customNo, "ShipBest", "提交订单", null, "成功");
  } catch (e) {
    if (e instanceof ShipBestError) {
      // ShipBest 明确拒绝：订单没有建成，退回扣款、删掉本地记录，修改后重试
      removeShipmentLedger(id);
      deleteShipment(id);
      throw e;
    }
    // 网络超时等：ShipBest 那边可能已经建单，保留记录，稍后用自定义单号刷新
    logProviderEvent(customNo, providerOf(channelCode), "提交订单", null, `提交结果未知：${(e as Error).message}`);
    updateShipment(id, { errorMsg: `提交结果未知（${(e as Error).message}），请稍后点“刷新状态”` });
    return id;
  }

  if (input.waitForLabel === false) return id;
  // 面单一般是异步生成，轮询几次
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 1200 : 2000));
    const s = await refreshShipment(id).catch(() => null);
    if (s && s.status !== "pending") break;
  }
  return id;
}

/* ---------------- 刷新状态 ---------------- */

export async function refreshShipment(id: number): Promise<Shipment> {
  const s = getShipment(id);
  if (!s) throw new Error("记录不存在");
  const d = await getShipBestClient().getOrder(s.orderNo ? { orderNo: s.orderNo } : { customNo: s.customNo });
  // 嘉谷的查询在接口层已经逐个记下；ShipBest 这里记一条状态
  if (!isJiaguCode(s.channelCode)) {
    logProviderEvent(s.customNo, "ShipBest", "查询状态", d.status, [SB_STATUS[d.status] ?? "", d.errorMsg, d.trackingNo ? `运单号 ${d.trackingNo}` : ""].filter(Boolean).join(" · "));
  }

  const patch: ShipmentPatch = {
    orderNo: d.orderNo || s.orderNo,
    sbStatus: d.status,
    trackingNo: d.trackingNo || s.trackingNo,
    labelUrl: d.labelUrl || s.labelUrl,
    errorMsg: d.errorMsg || null,
  };
  if (d.feePrice !== null && d.feePrice !== undefined && Number(d.feePrice) > 0) patch.actualCost = Number(d.feePrice);

  // 查询要等服务商返回，期间可能已经取消 / 确认取消：用最新的状态判断，不能用查询前的旧快照
  const cur = getShipment(id) ?? s;
  if (d.status === 6) {
    if (cur.status !== "cancelled") Object.assign(patch, cancelPatch(cur, wasLabeled(cur)));
  } else if (cur.status === "cancelled") {
    // 本地已经取消并退款的单不能被刷新“复活”；服务商那边却显示已出面单的，提示管理员核实
    if (d.status === 4) patch.errorMsg = "本地已取消并退款，但服务商显示已出面单，请和服务商核实是否已作废";
  } else if (cur.status !== "cancel_requested") {
    patch.status = d.status === 4 ? "labeled" : d.status === 3 ? "exception" : "pending";
    // 嘉谷：下单 5 分钟还没有面单基本就是出问题了 → 标异常，让客户联系我们或先换渠道重新下单，我们再找嘉谷处理
    if (patch.status === "pending" && !patch.labelUrl && isJiaguCode(s.channelCode) && labelOverdue(s.createdAt)) {
      patch.status = "exception";
      patch.errorMsg = JG_LABEL_TIMEOUT_MSG;
      if (s.status !== "exception") logProviderEvent(s.customNo, "系统", "系统判断", null, `下单 ${JG_LABEL_TIMEOUT_MIN} 分钟仍没有面单，标记为异常`);
    }
  }

  if (patch.labelUrl && !s.labelPath) {
    try {
      const saved = await downloadLabel(patch.labelUrl, s.customNo, { from: senderLines(s.sender) });
      patch.labelPath = saved.path;
      patch.labelMime = saved.mime;
      // 看看服务商的面单上是否已经印了 SKU，决定打印时要不要加印
      patch.labelSku = await detectLabelSku(readLabel(saved.path), saved.mime, s.skuList.map((k) => k.sku)).catch(() => "image" as const);
    } catch (e) {
      patch.errorMsg = (patch.errorMsg ? patch.errorMsg + "；" : "") + (e as Error).message;
    }
  }
  updateShipment(id, patch);
  settleCancel(id);
  // 刚变成异常：通知客户
  if (patch.status === "exception" && cur.status !== "exception") {
    const ref = s.customerRef || s.customNo;
    // 通知邮件给客户看：去掉服务商名称等内部信息
    const reason = patch.errorMsg ? publicError(patch.errorMsg) : "";
    notifyLater(s.customerId, "exception", { zh: `订单 ${ref} 出单异常`, en: `Order ${ref} has a problem` }, {
      zh: [`订单 ${ref} 出单异常${reason ? `：${reason}` : ""}。请登录查看，或联系客服处理。`],
      en: [`Order ${ref} could not be processed${reason ? `: ${reason}` : ""}. Please sign in to check or contact support.`],
    });
  }
  return getShipment(id)!;
}

/** 这张面单走的是哪家服务商 */
export function providerOf(channelCode: string) {
  return isJiaguCode(channelCode) ? "嘉谷" : "ShipBest";
}

/** 嘉谷下单后多久还没有面单算出问题 */
export const JG_LABEL_TIMEOUT_MIN = 5;
export const JG_LABEL_TIMEOUT_MSG = `嘉谷 ${JG_LABEL_TIMEOUT_MIN} 分钟内未出面单：请客户联系我们或换其他渠道重新下单，并联系嘉谷处理；处理完在这里取消（未出面单全额退款）`;

function labelOverdue(createdAt: string, now = Date.now()) {
  const t = Date.parse(createdAt.includes("T") ? createdAt : createdAt.replace(" ", "T") + "Z");
  return Number.isFinite(t) && now - t > JG_LABEL_TIMEOUT_MIN * 60_000;
}

/** 寄件人三行（模拟面单的 FROM） */
function senderLines(a: Address | null | undefined): string[] | undefined {
  if (!a?.address1) return undefined;
  const name = a.corporateName || [a.nameFirst, a.nameLast].filter(Boolean).join(" ");
  return [name, [a.address1, a.address2].filter(Boolean).join(" "), [a.city, a.province, a.zipCode].filter(Boolean).join(" ")].filter(Boolean);
}

/** 订单变成已取消后，把退款记入客户钱包（幂等） */
function settleCancel(id: number) {
  const s = getShipment(id);
  if (s?.status === "cancelled" && s.refundAmount) refundCancelled(s.customerId, id, s.refundAmount, "system");
}

/* ---------------- 取消 ---------------- */

/** 是否已经出过面单（出过面单的取消才收取消费） */
function wasLabeled(s: Shipment) {
  return s.sbStatus === 4 || !!s.trackingNo || !!s.labelPath;
}

/** 取消后的费用：已出面单按比例收取取消费，未出单不收费。 */
function cancelPatch(s: Shipment, charged: boolean, fees?: { cancelFee: number; sbCancelFee: number }): ShipmentPatch {
  const st = getSettings();
  const cost = s.actualCost ?? s.quotedCost;
  // 向客户收的取消费有零头时向上取到分
  // 公司自用账号不向自己收取消费（钱包本来就不扣），记 0，报表里才不会算成收入
  const cancelFee = isInternalCustomer(s.customerId) ? 0 : fees?.cancelFee ?? (charged ? roundUp((s.price * st.cancelFeePercent) / 100, 0.01) : 0);
  const sbCancelFee = fees?.sbCancelFee ?? (charged ? round2((cost * st.sbCancelFeePercent) / 100) : 0);
  return {
    status: "cancelled",
    cancelFee,
    sbCancelFee,
    refundAmount: round2(s.price - cancelFee),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * 申请取消：先尝试接口取消（未出单的订单通常可以直接取消）；
 * 接口不支持时标记为“取消处理中”，由员工在 OMS 联系 ShipBest 人工取消后再确认。
 */
export async function requestCancel(
  id: number,
  opts: { markOnFail?: boolean } = {},
): Promise<{ done: boolean; message: string }> {
  const s = getShipment(id);
  if (!s) throw new Error("记录不存在");
  if (s.status === "cancelled") return { done: true, message: "已经是取消状态" };
  try {
    await getShipBestClient().cancelOrder(s.orderNo ? { orderNo: s.orderNo } : { customNo: s.customNo });
    logProviderEvent(s.customNo, providerOf(s.channelCode), "申请取消", null, "成功");
    updateShipment(id, { ...cancelPatch(s, wasLabeled(s)), sbStatus: 6 });
    settleCancel(id);
    return { done: true, message: "已取消，费用已退回账户余额" };
  } catch (e) {
    logProviderEvent(s.customNo, providerOf(s.channelCode), "申请取消", e instanceof ShipBestError ? e.code : null, `失败：${(e as Error).message}`);
    // 客户自己申请：接口取消失败时不改状态（面单照常有效），只留一条记录给后台看
    if (opts.markOnFail === false) {
      updateShipment(id, { errorMsg: `客户申请取消，接口取消未成功：${(e as Error).message}` });
      return { done: false, message: (e as Error).message };
    }
    updateShipment(id, {
      status: "cancel_requested",
      errorMsg: `接口取消未成功：${(e as Error).message}。请在 OMS 联系 ShipBest 人工取消，完成后点“确认已取消”。`,
    });
    return { done: false, message: "已标记为取消处理中，请在 OMS 联系 ShipBest 人工取消" };
  }
}

export function confirmCancelled(id: number, cancelFee: number, sbCancelFee: number) {
  const s = getShipment(id);
  if (!s) throw new Error("记录不存在");
  if (s.status !== "cancel_requested") throw new Error("这张面单不在取消处理中");
  if (!Number.isFinite(cancelFee) || cancelFee < 0 || cancelFee > s.price) throw new Error("客户取消手续费要在 0 到客户价之间");
  if (!Number.isFinite(sbCancelFee) || sbCancelFee < 0) throw new Error("服务商取消费不能是负数");
  updateShipment(id, { ...cancelPatch(s, true, { cancelFee, sbCancelFee }), errorMsg: null });
  settleCancel(id);
}

/** ShipBest 拒绝取消（或申请错了）：撤回取消申请，恢复原状态 */
export function withdrawCancel(id: number) {
  const s = getShipment(id);
  if (!s) throw new Error("记录不存在");
  if (s.status !== "cancel_requested") throw new Error("这张面单不在取消处理中");
  updateShipment(id, { status: s.labelPath ? "labeled" : "pending", errorMsg: null });
}

/** 取消费默认值（给页面预填用）：没出过面单的不收取消费 */
export function defaultCancelFees(s: Shipment) {
  if (!wasLabeled(s)) return { cancelFee: 0, sbCancelFee: 0 };
  const st = getSettings();
  return {
    cancelFee: isInternalCustomer(s.customerId) ? 0 : roundUp((s.price * st.cancelFeePercent) / 100, 0.01),
    sbCancelFee: round2(((s.actualCost ?? s.quotedCost) * st.sbCancelFeePercent) / 100),
  };
}

/* ---------------- 异常单修改后重新下单 ---------------- */

export interface ResubmitResult {
  id: number;
  /** 原异常单：cancelled 已取消并退回 / requested 服务商取消未成功，等人工确认 */
  old: "cancelled" | "requested";
}

/**
 * 出单异常的订单（例如体积重量不对被服务商拒绝），修改信息后重新下单：
 * 1. 用改好的信息给同一个客户下一张新单（可以换渠道，价格按这个客户的规则）；
 * 2. 新单出单成功后关闭原异常单：先向服务商取消；服务商那边本身就是异常、没出过面单的，直接取消并全额退回；
 *    其他情况（例如嘉谷超时、可能稍后又出面单）标记“取消处理中”，和服务商确认后再点“确认已取消”。
 */
const resubmitting = new Set<number>();

export async function resubmitShipment(input: Omit<CreateInput, "customerId" | "createdBy"> & { oldId: number }): Promise<ResubmitResult> {
  const old = getShipment(input.oldId);
  if (!old) throw new Error("记录不存在");
  if (old.status !== "exception") throw new Error("只有出单异常的订单可以修改后重新下单");
  if (old.replacedBy) throw new Error("这张订单已经修改后重新下过单了");
  // 防止连点两次：同一张单正在重新下单时，第二次直接拒绝（不会下出两张新单）
  if (resubmitting.has(old.id)) throw new Error("这张订单正在重新下单，请稍候");
  resubmitting.add(old.id);
  let id: number;
  try {
    id = await createLabel({
      ...input,
      customerId: old.customerId,
      customerRef: input.customerRef ?? old.customerRef ?? undefined,
      createdBy: "admin",
    });
    updateShipment(old.id, { replacedBy: id });
  } finally {
    resubmitting.delete(old.id);
  }
  const fresh = getShipment(id)!;
  // 原单属于某个批量导入批次的，批次里这一行改成新单，整批打印、导出都跟着新单走
  db()
    .prepare("UPDATE batch_job_rows SET shipment_id = ?, channel_code = ?, channel_name = ?, price = ? WHERE shipment_id = ?")
    .run(id, fresh.channelCode, fresh.channelName, fresh.price, old.id);
  logProviderEvent(old.customNo, "系统", "修改后重新下单", null, `新单 ${fresh.customNo}`);

  const provider = providerOf(old.channelCode);
  try {
    await getShipBestClient().cancelOrder(old.orderNo ? { orderNo: old.orderNo } : { customNo: old.customNo });
    logProviderEvent(old.customNo, provider, "申请取消", null, "成功");
    updateShipment(old.id, { ...cancelPatch(old, wasLabeled(old)), sbStatus: 6, errorMsg: `已修改后重新下单（新单 ${fresh.customNo}），原单已取消` });
    settleCancel(old.id);
    return { id, old: "cancelled" };
  } catch (e) {
    const msg = (e as Error).message;
    logProviderEvent(old.customNo, provider, "申请取消", e instanceof ShipBestError ? e.code : null, `失败：${msg}`);
    if (old.sbStatus === 3 && !wasLabeled(old)) {
      // 服务商那边就是异常单、没有出面单，不会扣费：本地取消并全额退回
      updateShipment(old.id, { ...cancelPatch(old, false), errorMsg: `已修改后重新下单（新单 ${fresh.customNo}）。服务商那边是异常单、没有出面单，原单已取消并全额退回` });
      settleCancel(old.id);
      return { id, old: "cancelled" };
    }
    updateShipment(old.id, {
      status: "cancel_requested",
      errorMsg: `已修改后重新下单（新单 ${fresh.customNo}）。原单向服务商取消未成功：${msg}。请和服务商确认没有扣费后点“确认已取消”（没出面单的取消费填 0）`,
    });
    return { id, old: "requested" };
  }
}

/* ---------------- 后台自动取回面单 ---------------- */

/**
 * 已扣款但面单还没生成的订单（最近 3 天），定时向 ShipBest 刷新一次。
 * 避免客户离开页面后面单一直停在“等待出单”，需要逐单点“刷新”。
 */
export async function refreshPendingShipments(limit = 60) {
  const ids = (
    db()
      .prepare(
        `SELECT id FROM shipments WHERE status = 'pending' AND created_at >= datetime('now', '-3 days')
         AND created_at <= datetime('now', '-20 seconds') ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as { id: number }[]
  ).map((r) => r.id);
  for (const id of ids) await refreshShipment(id).catch(() => null);
  return ids.length;
}

const sweeper = globalThis as unknown as { __atrSweeper?: NodeJS.Timeout };

export function startPendingSweeper(intervalMs = 60_000) {
  if (sweeper.__atrSweeper) return;
  let busy = false;
  sweeper.__atrSweeper = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await refreshPendingShipments();
      await backfillLabelSku();
    } finally {
      busy = false;
    }
  }, intervalMs);
  sweeper.__atrSweeper.unref?.();
}
