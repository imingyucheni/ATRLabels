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
  API_TEST_ENV,
  isInternalCustomer,
  switchShipmentChannel,
  isTestAccount,
  TEST_ACCOUNT_ENV,
  duplicateRefMessage,
} from "./db";
import { precheck, rememberQuote } from "./coverage";
import { downloadLabel, readLabel } from "./labels";
import { backfillLabelSku, detectLabelSku } from "./labelSku";
import { chargeLabel, hasCancelRefund, refundCancelled, removeShipmentLedger } from "./ledger";
import { displayChannel } from "./channelDisplay";
import { notifyLater } from "./notify";
import type { AddressCheck } from "./addressCheck";
import { computePrice, resolveRule, roundUp, type MarkupRule, type PartialRule } from "./pricing";
import { pickRule, rebateFor } from "./markup";
import { getPromotion } from "./promotions";
import { checkLimits, checkMinSize } from "./channelLimits";
import { getShipBestClient, getTestAccountClient, shipbestMode, ShipBestError } from "./shipbest/client";
import { failoverFor, isJiaguCode, jiaguConfig, warehouseOfCode } from "./shipbest/jiagu";
import { checkMultiBox, isMultiBoxName, multiBoxRule, multiBoxWarnings, pkgFromPieces } from "./multiBox";
import { recordSpeed } from "./speedStats";
import { aesRequired, dhlSettings, hsDigits, isDhlCode, isInternational } from "./shipbest/dhl";
import { guessCarrier } from "./carriers";
import { publicError } from "./portal";
import { logProviderEvent, recordLabelFailure } from "./providerLog";
import { SB_STATUS } from "./shipbest/types";
import type { Address, FeeQuote, ShipmentRequest } from "./shipbest/types";
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
    ["country", "国家"],
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

/** 没有邮编的国家 / 地区（收件邮编可以不填） */
const NO_POSTCODE = new Set("AE AG AO AW BF BI BJ BO BS BW BZ CD CF CG CI CK CM DJ DM ER FJ GA GD GH GM GQ GY HK JM KI KM KN LC ML MO MR MS MW NR NU QA RW SB SC SL SR ST SY TF TG TK TL TO TT TV UG VU YE ZW".split(" "));

export interface ValidateOptions {
  /** 只试算运费（不出单）：不检查商品明细，试算前用 withQuoteSkus 补一个样品 */
  forQuote?: boolean;
}

export function validateRequest(req: ShipmentRequest, opts: ValidateOptions = {}): string[] {
  const errors: string[] = [];
  checkAddress(req.sender, "寄件人", errors, true);
  const intl = isInternational(req);
  // 有些国家没有邮编（例如香港、阿联酋）
  checkAddress(req.recipient, "收件人", errors, !(intl && NO_POSTCODE.has(req.recipient.country.toUpperCase())));
  if (intl) {
    const r = req.recipient;
    // DHL 要求：收件人电话必填，地址每行最多 45 个字符
    if (!r.phone?.trim()) errors.push("国际件收件人电话必填（快递员派送、海关联系要用）");
    for (const [k, label] of [["address1", "地址1"], ["address2", "地址2"], ["city", "城市"]] as const) {
      if ((r[k]?.length ?? 0) > 45) errors.push(`国际件收件人${label}最多 45 个字符，请分到地址2 / 地址3`);
    }
    if (!req.sender.phone?.trim()) errors.push("寄件人电话必填");
  }
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
    if (intl) {
      // 国际件报关：HS 编码、原产国
      const hs = hsDigits(s.hsCode);
      if (!hs) errors.push(n + "国际件海关编码（HS Code）必填，6–10 位数字");
      else if (hs.length < 6 || hs.length > 10) errors.push(n + `海关编码“${s.hsCode}”不对，应为 6–10 位数字`);
      if (s.originCountry && !isCountryCode(s.originCountry)) errors.push(n + `原产国“${s.originCountry}”不对，请填二字码，例如 CN、US`);
      if (!s.material?.trim()) errors.push(n + "国际件材质必填（英文，例如 100% cotton、plastic、stainless steel）");
    }
  });
  if (intl) {
    const hs = aesRequired(req.skuList);
    if (hs) errors.push(`海关编码 ${hs} 的申报总价值超过 $2,500：按美国出口规定要先做 AES 出口申报（ITN），暂时不能在线下单，请联系客服`);
  }
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
  const r = await syncChannelsDetailed();
  if (!r.count && r.errors.length) throw new Error(r.errors.join("；"));
  return r.count;
}

/**
 * 同步渠道：几家服务商同时取，取到的先存下来；没取到的那家（超时、出错）列在 errors 里，
 * 它原来的渠道不受影响（同步只新增 / 更新，不删除）。
 */
export async function syncChannelsDetailed(): Promise<{ count: number; errors: string[] }> {
  const client = getShipBestClient();
  const r = client.getProductsDetailed ? await client.getProductsDetailed() : { products: await client.getProducts(), errors: [] };
  upsertChannels(r.products);
  return { count: r.products.length, errors: r.errors };
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
  /** 提醒（不影响下单），例如包裹比渠道要求的最小尺寸还小 */
  warning?: string;
  /** 限时活动：客户看到的活动名、结束日期、原价 */
  promo?: { label: string; endsOn: string; originalPrice: number };
  rule?: MarkupRule;
  price?: number;
  profit?: number;
  /** 这个渠道报价用了多久（毫秒，后台看是哪家慢；不发给客户） */
  ms?: number;
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
    // DHL 的“分区”是时效说明（N 个工作日），邮编也是外国邮编：不能拿来给美国邮编补分区
    if (z5 && !isJiaguCode(code) && !isDhlCode(code)) {
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

/** 报价并记下用时（ms） */
async function quoteOne(customerId: number, channelCode: string, channelName: string, req: ShipmentRequest, rule?: MarkupRule): Promise<ChannelQuote> {
  const t0 = Date.now();
  const q = await quoteOneInner(customerId, channelCode, channelName, req, rule);
  return { ...q, ms: Date.now() - t0 };
}

async function quoteOneInner(customerId: number, channelCode: string, channelName: string, req: ShipmentRequest, rule?: MarkupRule) {
  // 多箱渠道（UPS HWT / FedEx MWT）只在“多箱寄出”里用；多箱的货只能走多箱渠道，并且要符合渠道的重量 / 箱数 / 尺寸要求
  const mb = multiBoxRule(getChannel(channelCode)?.name ?? channelName);
  if (req.pkg.pieces?.length) {
    if (!mb) return { channelCode, channelName, ok: false, error: "这个渠道不支持多箱下单" } satisfies ChannelQuote;
    const errs = checkMultiBox(mb, req.pkg.pieces, [], { state: req.recipient?.province });
    if (errs.length) return { channelCode, channelName, ok: false, error: errs[0] } satisfies ChannelQuote;
    const res = await quoteRemote(customerId, channelCode, channelName, req, rule);
    // 会多收钱的情况（例如 FedEx MWT 的超重 / 超尺寸箱子）：照常报价，加提醒
    const warn = res.ok ? multiBoxWarnings(mb, req.pkg.pieces) : [];
    return warn.length ? { ...res, warning: warn.join("；") } : res;
  }
  if (mb) return { channelCode, channelName, ok: false, error: "多箱渠道请在“多箱寄出”里下单" } satisfies ChannelQuote;
  // 最近查过“不通邮”的邮编（或打开了邮编表预筛）直接判定送不到，不再调接口
  const zip = req.recipient?.zipCode ?? "";
  // 渠道的重量 / 尺寸限制（例如 GOFO 计费重 20 磅以内）：超出的直接不报价
  const over = checkLimits(channelCode, req);
  if (over) return { channelCode, channelName, ok: false, error: over } satisfies ChannelQuote;
  // 国际件（DHL）的邮编各国重复，不用“最近查过不通邮的邮编”这套记忆
  const dhl = isDhlCode(channelCode);
  const pre = dhl ? null : precheck(channelCode, zip);
  if (pre) return { channelCode, channelName, ok: false, error: pre } satisfies ChannelQuote;
  const res = await quoteRemote(customerId, channelCode, channelName, req, rule);
  if (!dhl) rememberQuote(channelCode, zip, res.ok, res.error);
  // 包裹太小：照常报价，只提醒
  const small = res.ok ? checkMinSize(channelCode, req) : null;
  return small ? { ...res, warning: small } : res;
}

/**
 * 服务商报价短时缓存（3 分钟）：同一个包裹“查询运费”之后马上下单，下单前的复核不用再等一遍接口；
 * 只缓存成功的报价，键里包含影响运费的全部信息（地址、包裹、签名、保险、申报），任何一项改了都会重新查。
 */
const QUOTE_TTL = 3 * 60_000;
const g = globalThis as unknown as { __quoteCache?: Map<string, { at: number; q: FeeQuote }> };
const quoteCache = (g.__quoteCache ??= new Map());

function quoteKey(code: string, req: ShipmentRequest) {
  const a = (x: ShipmentRequest["sender"]) => [x.country, x.province, x.city, x.zipCode, x.address1, x.address2].map((v) => (v ?? "").trim().toUpperCase()).join("|");
  return JSON.stringify([code, providerFingerprint(code), a(req.sender), a(req.recipient), req.pkg, req.skuList.map((k) => [k.quantity, k.declaredUnitPrice, k.productNature])]);
}

/**
 * 报价缓存也要区分服务商的连接设置：切换模拟 / 沙盒 / 正式、换账号、改嘉谷仓库后，
 * 不能拿 3 分钟内旧设置下的成本去卖（只用账号 ID 这类标识，不放密钥）
 */
function providerFingerprint(code: string): string {
  try {
    if (isJiaguCode(code)) {
      const cfg = jiaguConfig();
      return cfg ? `jg|${cfg.apiUrl}|${cfg.customerId}|${warehouseOfCode(cfg, code)}` : "jg|off";
    }
    if (isDhlCode(code)) {
      const d = dhlSettings();
      return `dhl|${shipbestMode()}|${d.mode}|${d.accountNumber}`;
    }
    return `sb|${shipbestMode()}|${getSettings().shipbest?.apiId ?? ""}`;
  } catch {
    return "?";
  }
}

/** 测试用：清空报价缓存 */
export function clearQuoteCache() {
  quoteCache.clear();
}

/** 正在进行的合并报价（primeQuotes 发出去的）：同一个渠道 + 同一个包裹直接等它，不再单独请求 */
const gi = globalThis as unknown as { __quoteInflight?: Map<string, Promise<FeeQuote | null>> };
const inflight = (gi.__quoteInflight ??= new Map());

/**
 * 报价前先把能合并的渠道一次问完（目前是嘉谷：同一个仓库的渠道一个请求，不同仓库同时发）。
 * 之后每个渠道照常走 quoteOne / trialPriceCached，拿的是这里已经在路上的结果。
 */
export function primeQuotes(codes: string[], req: ShipmentRequest) {
  let client: ReturnType<typeof getShipBestClient>;
  try {
    client = getShipBestClient();
  } catch {
    return;
  }
  if (!client.trialPriceMany) return;
  const todo = codes.filter((code) => {
    const key = quoteKey(code, req);
    const hit = quoteCache.get(key);
    return !(hit && Date.now() - hit.at < QUOTE_TTL) && !inflight.has(key);
  });
  if (todo.length < 2) return;
  const t0 = Date.now();
  for (const [code, p] of client.trialPriceMany(todo, req)) {
    const key = quoteKey(code, req);
    const done = p.then(
      (q) => {
        const ms = Date.now() - t0;
        recordSpeed(providerOf(code), ms, true);
        if (ms > 5000) console.warn(`[报价] ${getChannel(code)?.name ?? code} 用了 ${(ms / 1000).toFixed(1)} 秒（合并请求）`);
        if (q) quoteCache.set(key, { at: Date.now(), q });
        return q;
      },
    );
    p.catch(() => recordSpeed(providerOf(code), Date.now() - t0, false));
    inflight.set(key, done);
    // 没有渠道来取（例如被重量限制挡掉了）也不能留下未处理的错误
    done.catch(() => null).finally(() => inflight.delete(key));
  }
}

async function trialPriceCached(channelCode: string, req: ShipmentRequest): Promise<FeeQuote | null> {
  const key = quoteKey(channelCode, req);
  const hit = quoteCache.get(key);
  if (hit && Date.now() - hit.at < QUOTE_TTL) return hit.q;
  const pending = inflight.get(key);
  if (pending) return pending;
  const t0 = Date.now();
  let q: FeeQuote | null;
  try {
    q = await getShipBestClient().trialPrice(channelCode, req);
  } catch (e) {
    recordSpeed(providerOf(channelCode), Date.now() - t0, false);
    throw e;
  }
  const ms = Date.now() - t0;
  recordSpeed(providerOf(channelCode), ms, true);
  // 慢的渠道记一笔，方便看是哪个服务商拖慢了报价（journalctl 里能看到）
  if (ms > 5000) console.warn(`[报价] ${getChannel(channelCode)?.name ?? channelCode} 用了 ${(ms / 1000).toFixed(1)} 秒`);
  if (q) {
    quoteCache.set(key, { at: Date.now(), q });
    if (quoteCache.size > 2000) for (const [k, v] of quoteCache) if (Date.now() - v.at >= QUOTE_TTL) quoteCache.delete(k);
  }
  return q;
}

async function quoteRemote(customerId: number, channelCode: string, channelName: string, req: ShipmentRequest, ruleOverride?: MarkupRule): Promise<ChannelQuote> {
  const { roundingStep } = getSettings();
  try {
    const q = await trialPriceCached(channelCode, req);
    if (!q) return { channelCode, channelName, ok: false, error: "该渠道无报价" } satisfies ChannelQuote;
    // 以“优惠后总运费”作为我们的成本
    const cost = q.totalDiscountShippingFee || q.totalShippingFee;
    // 服务商返回的运费是 0 / 负数 / 看不懂：当作这个渠道没报价，不能按 0 成本卖出去
    if (!Number.isFinite(cost) || cost <= 0) return { channelCode, channelName, ok: false, error: "该渠道暂时无法报价" } satisfies ChannelQuote;
    // 钱包是美元：服务商报的不是美元时不能直接当美元收
    if (q.currency && q.currency.toUpperCase() !== "USD") return { channelCode, channelName, ok: false, error: "该渠道报价币种不是美元，暂不支持" } satisfies ChannelQuote;
    // 公司自用账户按成本价：不做价格取整
    const step = isInternalCustomer(customerId) ? 0.01 : roundingStep;
    // 限时活动价和平时价取低的（活动不能让任何客户变贵）；活动价更低时客户端显示“原价 / 限时价”
    const picked = pickRule(customerId, channelCode, cost, step, ruleOverride);
    const { rule, price } = picked;
    const promo = picked.promo && rule.promoId ? getPromotion(rule.promoId) : null;
    const originalPrice = promo ? picked.normalPrice : null;
    const rebate = rule.rebate ? Math.round(cost * rule.rebate) / 100 : 0;
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
      profit: Math.round((price - cost + rebate) * 100) / 100,
      ...(promo && originalPrice && originalPrice > price ? { promo: { label: promo.label, endsOn: promo.endsOn, originalPrice } } : {}),
    } satisfies ChannelQuote;
  } catch (e) {
    return { channelCode, channelName, ok: false, error: (e as Error).message } satisfies ChannelQuote;
  }
}

/**
 * 对这个客户已开通（且全局启用）的渠道逐个试算。
 * 注：试算接口只返回渠道 id 和名称、不返回 code，所以按 code 逐个请求，保证下单时 code 对得上。
 */
/**
 * 并发试算多个渠道：ShipBest 和嘉谷各走各的队列（两家的频率限制互不影响），
 * ShipBest 同时 3 个（避免触发频率限制 11005），嘉谷同时 4 个；总时间约等于最慢那家的时间。
 */
/** 边查边报：开始时告诉要查哪些渠道，每查完一个就回调一次（下单页一个一个显示出来，不用等最慢的那家） */
export interface QuoteHooks {
  onStart?: (channels: { code: string; name: string }[]) => void;
  onEach?: (q: ChannelQuote) => void;
}

async function quoteChannels<C extends { code: string; name: string }>(channels: C[], fn: (c: C) => Promise<ChannelQuote>, req?: ShipmentRequest, hooks?: QuoteHooks): Promise<ChannelQuote[]> {
  hooks?.onStart?.(channels.map((c) => ({ code: c.code, name: c.name })));
  // 嘉谷的渠道先合并成几个请求一起发出去，下面逐个渠道处理时直接用结果
  if (req) primeQuotes(channels.map((c) => c.code).filter((c) => isJiaguCode(c)), req);
  const results: ChannelQuote[] = [];
  const run = async (list: C[], size: number) => {
    const queue = [...list];
    await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const q = await fn(c);
        results.push(q);
        hooks?.onEach?.(q);
      }
    }));
  };
  await Promise.all([run(channels.filter((c) => !isJiaguCode(c.code)), 3), run(channels.filter((c) => isJiaguCode(c.code)), 4)]);
  return results;
}

/** 按收件国家挑渠道：国际件只走 DHL，美国境内不走 DHL */
export function forDestination<C extends { code: string }>(channels: C[], req: Pick<ShipmentRequest, "recipient">): C[] {
  const intl = isInternational(req);
  return channels.filter((c) => isDhlCode(c.code) === intl);
}

export async function quoteAll(customerId: number, req: ShipmentRequest, hooks?: QuoteHooks): Promise<ChannelQuote[]> {
  if (!listChannels(true).length) throw new Error("没有启用的物流渠道，请先到“设置”里同步渠道");
  const all = customerChannels(customerId);
  if (!all.length) throw new NoChannelsError();
  // 寄往美国以外：只用国际快递渠道（DHL）；寄美国：只用尾程渠道。多箱渠道不参与普通下单报价
  const channels = forDestination(all, req).filter((c) => !isMultiBoxName(c.name));
  if (!channels.length) throw new Error(isInternational(req) ? "您的账户还没有开通国际快递渠道（DHL），请联系客服开通" : "您的账户还没有开通美国本土渠道，请联系客服开通");
  const results = await quoteChannels(channels, (c) => quoteOne(customerId, c.code, c.name, req), req, hooks);
  return flagJiaguCoverage(fillZones(results)).sort((a, b) => Number(b.ok) - Number(a.ok) || (a.price ?? 0) - (b.price ?? 0));
}

/** 多箱寄出：包裹字段按箱规算成汇总（最大那箱的尺寸 + 总重量，英寸 / 磅） */
function withPieceTotals(req: ShipmentRequest): ShipmentRequest {
  const pieces = req.pkg.pieces;
  return pieces?.length ? { ...req, pkg: { ...req.pkg, ...pkgFromPieces(pieces), displayUnitSystem: 3 } } : req;
}

/** 多箱寄出：只用客户开通的多箱渠道（UPS HWT / FedEx MWT）报价 */
export async function quoteMulti(customerId: number, raw: ShipmentRequest): Promise<ChannelQuote[]> {
  if (!raw.pkg.pieces?.length) throw new Error("请填写箱规和箱数");
  const req = withPieceTotals(raw);
  const channels = customerChannels(customerId).filter((c) => isMultiBoxName(c.name) && !isDhlCode(c.code));
  if (!channels.length) throw new Error("还没有开通多箱渠道（UPS HWT / FedEx MWT），请联系客服开通");
  const results = await quoteChannels(channels, (c) => quoteOne(customerId, c.code, c.name, req), req);
  return results.sort((a, b) => Number(b.ok) - Number(a.ok) || (a.price ?? 0) - (b.price ?? 0));
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
export async function quoteForProspect(req: ShipmentRequest, markup: PartialRule, hooks?: QuoteHooks): Promise<ChannelQuote[]> {
  const channels = forDestination(listChannels(true), req).filter((c) => !isMultiBoxName(c.name));
  if (!channels.length) throw new Error("没有启用的物流渠道，请先到“设置”里同步渠道");
  const gm = getSettings().markup;
  // 和真实客户一样算：渠道长期返利兜底、限时活动价（在 pickRule 里和平时价取低的）
  const ruleOf = (c: { code: string; markup?: PartialRule | null; rebate?: number }) => ({ ...resolveRule(gm, c.markup, markup), source: "prospect", ...((c.rebate ?? 0) > 0 ? { rebate: c.rebate } : {}) });
  const results = await quoteChannels(channels, (c) => quoteOne(0, c.code, c.name, req, ruleOf(c)), req, hooks);
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
  /** 开放 API 的测试密钥：模拟出单，不连服务商、不扣余额 */
  simulate?: boolean;
}

/** 开放 API 测试密钥出的单（模拟面单，不扣钱） */
export { API_TEST_ENV };

export async function createLabel(input: CreateInput): Promise<number> {
  const { customerId, channelCode } = input;
  const req: ShipmentRequest = withPieceTotals({ ...input.req, skuList: input.req.skuList.map(fillProductNames) });
  if (!getCustomer(customerId)) throw new Error("客户不存在");
  const ref = input.customerRef?.trim() || "";
  // 同一个订单号不能重复下单（取消后可以重新下）
  const dupe = ref ? activeShipmentByRef(customerId, ref, { apiTest: !!input.simulate }) : undefined;
  if (dupe) throw new Error(duplicateRefMessage(ref, dupe));
  const errors = validateRequest(req);
  if (errors.length) throw new Error(errors.join("；"));

  const channel = getChannel(channelCode);
  if (!channel?.enabled) throw new Error("渠道不存在或已停用");
  if (!customerCanUse(customerId, channelCode)) throw new Error("该客户未开通此渠道");
  // DHL、嘉谷的接口申报价值一律按美元：填了别的币种会被当成美元申报（例如人民币 90 报成 90 美元）
  if (isDhlCode(channelCode) || isJiaguCode(channelCode)) {
    const other = req.skuList.find((k) => k.declaredCurrency && k.declaredCurrency.trim().toUpperCase() !== "USD");
    if (other) throw new Error(`这个渠道的申报价值只能用美元（USD），请把币种 ${other.declaredCurrency} 换算成美元后再下单`);
  }
  // 多箱寄出：出单前再检查一遍渠道要求（含英文品名、海关编码）
  if (req.pkg.pieces?.length) {
    const mb = multiBoxRule(channel.name);
    if (!mb) throw new Error("这个渠道不支持多箱下单");
    const errs = checkMultiBox(mb, req.pkg.pieces, req.skuList, { forOrder: true, state: req.recipient?.province });
    if (errs.length) throw new Error(errs.join("；"));
  }

  // 下单前重新试算一次，价格有变化则让员工确认
  const quote = await quoteOne(customerId, channelCode, channel.name, req);
  if (!quote.ok) throw new Error(quote.error);
  if (Math.abs((quote.price ?? 0) - input.expectedPrice) > 0.005) throw new PriceChangedError(quote);

  const customNo = newCustomNo();
  const createdBy = input.createdBy ?? "admin";
  // 内部测试账号：模拟出单，不连服务商
  const testAccount = isTestAccount(customerId) || !!input.simulate;
  // 建本地记录和扣款放在同一个事务里：余额不足时什么都不留下
  const id = db().transaction(() => {
    // 试算期间可能已经有同号的单提交了（重复点击 / 两个页面同时下单），入库前再查一次
    const again = ref ? activeShipmentByRef(customerId, ref, { apiTest: !!input.simulate }) : undefined;
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
    env: input.simulate ? API_TEST_ENV : testAccount ? TEST_ACCOUNT_ENV : shipbestMode(),
    addressCheck: input.addressCheck && input.addressCheck.status !== "unavailable" && input.addressCheck.status !== "skipped" ? JSON.stringify(input.addressCheck) : null,
    });
    if (!input.simulate) chargeLabel(customerId, newId, quote.price!, createdBy, `运费 · ${displayChannel(channelCode).name || quote.channelName}${quote.zone ? ` · ${quote.zone}` : ""}`);
    return newId;
  })();

  try {
    await (testAccount ? getTestAccountClient() : getShipBestClient()).createOrder(customNo, channelCode, req, input.remark);
    if (!isJiaguCode(channelCode)) logProviderEvent(customNo, providerOf(channelCode), "提交订单", null, "成功");
  } catch (e) {
    // 主渠道明确拒绝：有设置自动备用的，备用还能赚（利润率 ≥ 5%）就改用备用渠道出单，客户价不变
    if (e instanceof ShipBestError && !testAccount && (await tryFailover(id, customNo, customerId, channelCode, quote, req, input.remark, e))) {
      if (ref) await closeSupersededExceptions(customerId, ref, id).catch(() => null);
      if (input.waitForLabel === false) return id;
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, i === 0 ? 1200 : 2000));
        const s = await refreshShipment(id).catch(() => null);
        if (s && s.status !== "pending") break;
      }
      return id;
    }
    if (e instanceof ShipBestError) {
      // ShipBest 明确拒绝：订单没有建成，退回扣款、删掉本地记录，修改后重试
      // 后台留一条出单失败记录（渠道、收件地、包裹、品名、对方原话）
      if (!testAccount) {
        const u = req.pkg.displayUnitSystem === 3 ? ["in", "lb"] : req.pkg.displayUnitSystem === 2 ? ["cm", "kg"] : ["cm", "g"];
        recordLabelFailure({
          customerId,
          channelCode,
          channelName: quote.channelName,
          customerRef: ref || null,
          recipient: `${req.recipient.city} ${req.recipient.province ?? ""} ${req.recipient.zipCode}`,
          pkg: `${req.pkg.length}×${req.pkg.width}×${req.pkg.height} ${u[0]} · ${req.pkg.weight} ${u[1]}`,
          items: req.skuList.map((k) => `${k.productNameEn} ×${k.quantity}`).join(", "),
          error: e.message,
        });
      }
      removeShipmentLedger(id);
      deleteShipment(id);
      throw e;
    }
    // 网络超时等：ShipBest 那边可能已经建单，保留记录，稍后用自定义单号刷新
    logProviderEvent(customNo, providerOf(channelCode), "提交订单", null, `提交结果未知：${(e as Error).message}`);
    updateShipment(id, { errorMsg: `提交结果未知（${(e as Error).message}），请稍后点“刷新状态”` });
    return id;
  }
  if (ref) await closeSupersededExceptions(customerId, ref, id).catch(() => null);

  if (input.waitForLabel === false) return id;
  // 面单一般是异步生成，轮询几次
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 1200 : 2000));
    const s = await refreshShipment(id).catch(() => null);
    if (s && s.status !== "pending") break;
  }
  return id;
}

/** 自动备用：备用渠道的利润率至少要有这么多才切（按客户价算） */
export const FAILOVER_MIN_MARGIN = 0.05;

/**
 * 主渠道下单被拒后，改用备用渠道（同一个嘉谷产品的备用仓库）出单。
 * 客户价不变；渠道、成本、利润按实际出单的备用渠道记。备用会亏（利润率不到 5%）、报不出价或也被拒，返回 false，按原来的失败处理。
 */
async function tryFailover(
  id: number, customNo: string, customerId: number, mainCode: string,
  quote: ChannelQuote, req: ShipmentRequest, remark: string | undefined, err: Error,
): Promise<boolean> {
  const backup = failoverFor(jiaguConfig(), mainCode);
  const ch = backup ? getChannel(backup) : null;
  if (!backup || !ch?.enabled) return false;
  const log = (msg: string) => logProviderEvent(customNo, "嘉谷", "自动备用", null, msg);
  let cost: number;
  let zone: string | null = null;
  try {
    const q = await getShipBestClient().trialPrice(backup, req);
    cost = q ? q.totalDiscountShippingFee || q.totalShippingFee : 0;
    zone = q?.zone ?? null;
  } catch (e2) {
    log(`主渠道被拒（${err.message}），备用渠道 ${ch.name} 报价失败：${(e2 as Error).message}，没有切换`);
    return false;
  }
  const price = quote.price ?? 0;
  // 利润、对账按实际出单的备用渠道算：返利用备用渠道自己的（主渠道的限时活动 / 返利不跟过去）
  const backupRebate = rebateFor(backup);
  const netCost = cost * (1 - backupRebate / 100);
  const mainNetCost = (quote.cost ?? 0) * (1 - (quote.rule?.rebate ?? 0) / 100);
  // 公司自用账号按成本价收：不看利润，只要备用不比主渠道贵
  const ok = isInternalCustomer(customerId) ? cost > 0 && netCost <= mainNetCost + 1e-9 : cost > 0 && price - netCost >= price * FAILOVER_MIN_MARGIN;
  if (!ok) {
    log(`主渠道被拒（${err.message}），备用渠道 ${ch.name} 成本 ${cost.toFixed(2)}${backupRebate ? `（返利 ${backupRebate}%）` : ""}，客户价 ${price.toFixed(2)}，利润率不到 ${FAILOVER_MIN_MARGIN * 100}%，没有切换`);
    return false;
  }
  const { promoId: _promo, rebate: _rebate, ...keep } = quote.rule ?? { percent: 0, fixed: 0, minProfit: 0 };
  const backupRule: MarkupRule = { ...keep, ...(quote.rule?.source === "promo" ? { source: "failover" } : {}), ...(backupRebate > 0 ? { rebate: backupRebate } : {}) };
  try {
    await getShipBestClient().createOrder(customNo, backup, req, remark);
  } catch (e2) {
    log(`主渠道被拒（${err.message}），备用渠道 ${ch.name} 也下单失败：${(e2 as Error).message}`);
    if (e2 instanceof ShipBestError) return false;
    // 备用提交结果未知：订单可能已经在嘉谷建好，按备用渠道留着，稍后刷新
    switchShipmentChannel(id, backup, ch.name, cost, zone, backupRule);
    updateShipment(id, { errorMsg: `提交结果未知（${(e2 as Error).message}），请稍后点“刷新状态”` });
    return true;
  }
  switchShipmentChannel(id, backup, ch.name, cost, zone, backupRule);
  log(`主渠道 ${getChannel(mainCode)?.name ?? mainCode} 被拒（${err.message}），已自动改用 ${ch.name} 出单：成本 ${cost.toFixed(2)}（原 ${(quote.cost ?? 0).toFixed(2)}），客户价 ${price.toFixed(2)} 不变`);
  return true;
}

/* ---------------- 刷新状态 ---------------- */

export async function refreshShipment(id: number): Promise<Shipment> {
  const s = getShipment(id);
  if (!s) throw new Error("记录不存在");
  const d = await clientFor(s).getOrder(s.orderNo ? { orderNo: s.orderNo } : { customNo: s.customNo });
  // 嘉谷的查询在接口层已经逐个记下；ShipBest 这里记一条状态
  if (!isJiaguCode(s.channelCode)) {
    logProviderEvent(s.customNo, providerOf(s.channelCode), "查询状态", d.status, [SB_STATUS[d.status] ?? "", d.errorMsg, d.trackingNo ? `运单号 ${d.trackingNo}` : ""].filter(Boolean).join(" · "));
  }

  const patch: ShipmentPatch = {
    orderNo: d.orderNo || s.orderNo,
    sbStatus: d.status,
    trackingNo: d.trackingNo || s.trackingNo,
    labelUrl: d.labelUrl || s.labelUrl,
    errorMsg: d.errorMsg || null,
  };
  if (d.feePrice !== null && d.feePrice !== undefined && Number(d.feePrice) > 0) patch.actualCost = Number(d.feePrice);

  // 面单先下载好（要等），再读最新状态决定怎么改：等待期间可能已经取消 / 申请取消 / 确认取消，
  // 不能用等待之前的旧快照把状态改回去（例如把已经退款的单改回“已出单”）
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
  // 从这里到写回之间没有等待，读到的就是最新状态
  const cur = getShipment(id) ?? s;
  let justTimedOut = false;
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
      if (cur.status !== "exception") {
        logProviderEvent(s.customNo, "系统", "系统判断", null, `下单 ${JG_LABEL_TIMEOUT_MIN} 分钟仍没有面单，标记为异常`);
        justTimedOut = true;
      }
    }
  }

  updateShipment(id, patch);
  settleCancel(id);

  // 嘉谷超时：马上向嘉谷作废这张单并全额退款，客户直接换渠道重下，不会出现“后来面单又出来了、两张都扣费”
  if (justTimedOut && (await autoVoid(getShipment(id)!, JG_TIMEOUT_VOIDED_MSG))) {
    const ref = s.customerRef || s.customNo;
    notifyLater(s.customerId, "exception", { zh: `订单 ${ref} 出单超时，已自动取消`, en: `Order ${ref} timed out and was cancelled` }, {
      zh: [`订单 ${ref} 的渠道出单超时，系统已自动取消并全额退回余额，请换其他渠道重新下单。`],
      en: [`Order ${ref} timed out on this service. It has been cancelled and fully refunded; please ship it again with another service.`],
    });
    return getShipment(id)!;
  }
  // 超时后客户已经换单重下，但这张单的面单后来又生成了：自动作废这张迟到的面单，不让客户付两次（客户不收取消费）
  if (cur.status === "exception" && cur.replacedBy && patch.status === "labeled") {
    const fresh = getShipment(cur.replacedBy);
    const note = `客户已换单重新下单（新单 ${fresh?.customNo ?? cur.replacedBy}），这张单的面单延迟生成，系统已自动作废并全额退款`;
    if (!(await autoVoid(getShipment(id)!, note, true))) {
      updateShipment(id, {
        status: "cancel_requested",
        errorMsg: `客户已换单重新下单（新单 ${fresh?.customNo ?? cur.replacedBy}），这张单的面单延迟生成、自动作废没有成功。请联系服务商作废后点“确认已取消”（客户取消费填 0）`,
      });
    }
    return getShipment(id)!;
  }

  // 超时转异常（自动作废没成功）的单，面单后来又生成了：客户可能已经换渠道重新下单，提醒客户和后台，避免两张都用 / 都扣费
  if (cur.status === "exception" && !cur.replacedBy && patch.status === "labeled" && (cur.errorMsg === JG_LABEL_TIMEOUT_MSG || cur.errorMsg === JG_TIMEOUT_VOIDED_MSG)) {
    const ref = s.customerRef || s.customNo;
    updateShipment(id, { errorMsg: "这张单超时后面单才生成：如果已经换渠道重新下过单，请取消这一张，避免重复扣费" });
    logProviderEvent(s.customNo, "系统", "系统判断", null, "超时转异常后面单又生成了，已提醒客户核对是否重复下单");
    notifyLater(s.customerId, "exception", { zh: `订单 ${ref} 的面单已生成（超时后）`, en: `Label for order ${ref} was created late` }, {
      zh: [`订单 ${ref} 之前出单超时，现在面单已经生成并扣费。如果您已经换其他渠道重新下过这一单，请在订单详情里取消这一张，避免重复扣费；没有重新下单的话可以正常使用这张面单。`],
      en: [`Order ${ref} timed out earlier, but its label has now been created and charged. If you already shipped this order with another service, please cancel this label in the order details to avoid paying twice; otherwise you can use it normally.`],
    });
    return getShipment(id)!;
  }

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

/** 这张单该用哪个接口：内部测试账号 / 模拟、沙盒时下的单用模拟接口，正式单用正式接口 */
function clientFor(s: { isTest: boolean }) {
  return s.isTest ? getTestAccountClient() : getShipBestClient();
}

/** 这张面单走的是哪家服务商 */
export function providerOf(channelCode: string) {
  return isDhlCode(channelCode) ? "DHL" : isJiaguCode(channelCode) ? "嘉谷" : "ShipBest";
}

/** 嘉谷下单后多久还没有面单算出问题 */
export const JG_LABEL_TIMEOUT_MIN = 5;
export const JG_LABEL_TIMEOUT_MSG = `嘉谷 ${JG_LABEL_TIMEOUT_MIN} 分钟内未出面单：请客户联系我们或换其他渠道重新下单，并联系嘉谷处理；处理完在这里取消（未出面单全额退款）`;

export const JG_TIMEOUT_VOIDED_MSG = `嘉谷 ${JG_LABEL_TIMEOUT_MIN} 分钟内未出面单，系统已自动向嘉谷取消并全额退款：请换其他渠道重新下单`;

/**
 * 系统自动向服务商作废一张单（不收客户取消费）并退款。
 * sbCharged = 服务商那边已经出过面单，可能收我们取消费（按设置的比例记下来，对账用）。
 */
async function autoVoid(s: Shipment, note: string, sbCharged = false): Promise<boolean> {
  const provider = providerOf(s.channelCode);
  try {
    await clientFor(s).cancelOrder(s.orderNo ? { orderNo: s.orderNo } : { customNo: s.customNo });
  } catch (e) {
    logProviderEvent(s.customNo, provider, "系统自动取消", e instanceof ShipBestError ? e.code : null, `失败：${(e as Error).message}`);
    return false;
  }
  logProviderEvent(s.customNo, provider, "系统自动取消", null, "成功");
  const latest = getShipment(s.id) ?? s;
  if (latest.status === "cancelled") return true;
  const sbCancelFee = sbCharged ? defaultCancelFees({ ...latest, sbStatus: 4 }).sbCancelFee : 0;
  updateShipment(s.id, { ...cancelPatch(latest, false, { cancelFee: 0, sbCancelFee }), sbStatus: 6, errorMsg: note });
  settleCancel(s.id);
  return true;
}

/**
 * 客户用同一个订单号重新下单成功后，关闭之前出单异常的那张：
 * 能向服务商作废的直接取消并全额退款；服务商那边本来就是异常、没出面单的，本地取消退款；
 * 作废不了的先关联到新单，之后如果面单迟到了，刷新时会自动作废。
 */
async function closeSupersededExceptions(customerId: number, ref: string, newId: number) {
  const olds = db()
    .prepare("SELECT id FROM shipments WHERE customer_id = ? AND customer_ref = ? AND status = 'exception' AND replaced_by IS NULL AND id <> ?")
    .all(customerId, ref, newId) as { id: number }[];
  const fresh = getShipment(newId)!;
  for (const { id } of olds) {
    const old = getShipment(id)!;
    updateShipment(id, { replacedBy: newId });
    logProviderEvent(old.customNo, "系统", "同一订单号重新下单", null, `新单 ${fresh.customNo}`);
    const note = `已用同一订单号重新下单（新单 ${fresh.customNo}），原单已取消并全额退款`;
    if (await autoVoid(old, note)) continue;
    if (old.sbStatus === 3 && !wasLabeled(old)) {
      updateShipment(id, { ...cancelPatch(old, false), errorMsg: `已用同一订单号重新下单（新单 ${fresh.customNo}）。服务商那边是异常单、没有出面单，原单已取消并全额退款` });
      settleCancel(id);
    }
  }
}

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
  // API 测试密钥的模拟单没扣过钱，也不退
  if (s?.env === API_TEST_ENV) return;
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
  // DHL 没揽收的运单不计费：我们这边没有服务商取消费
  const sbCancelFee = fees?.sbCancelFee ?? (charged && !isDhlCode(s.channelCode) ? round2((cost * st.sbCancelFeePercent) / 100) : 0);
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
  // 同一张单同时只处理一个取消（客户和后台同时点、接口超时重试），避免一个成功退款、另一个又把状态改成“取消处理中”
  if (cancelling.has(id)) return { done: false, message: "这一单正在取消，请稍后刷新查看结果" };
  cancelling.add(id);
  try {
    return await doCancel(s, opts);
  } finally {
    cancelling.delete(id);
  }
}

const cancelling = ((globalThis as unknown as { __cancelling?: Set<number> }).__cancelling ??= new Set<number>());

async function doCancel(s: Shipment, opts: { markOnFail?: boolean }): Promise<{ done: boolean; message: string }> {
  const id = s.id;
  try {
    await clientFor(s).cancelOrder(s.orderNo ? { orderNo: s.orderNo } : { customNo: s.customNo });
    logProviderEvent(s.customNo, providerOf(s.channelCode), "申请取消", null, "成功");
    // 等服务商期间面单可能刚生成（要收取消费）或已经被别处取消：按最新状态算
    const cur = getShipment(id) ?? s;
    if (cur.status === "cancelled") return { done: true, message: "已经是取消状态" };
    updateShipment(id, { ...cancelPatch(cur, wasLabeled(cur)), sbStatus: 6 });
    settleCancel(id);
    return { done: true, message: "已取消，费用已退回账户余额" };
  } catch (e) {
    logProviderEvent(s.customNo, providerOf(s.channelCode), "申请取消", e instanceof ShipBestError ? e.code : null, `失败：${(e as Error).message}`);
    const cur = getShipment(id) ?? s;
    if (cur.status === "cancelled") return { done: true, message: "已经是取消状态" };
    // 内部测试账号的单是模拟面单，没有真实面单要作废：直接取消，按规则退款
    if (cur.isTest && (isTestAccount(cur.customerId) || cur.env === API_TEST_ENV)) {
      updateShipment(id, { ...cancelPatch(cur, wasLabeled(cur)), sbStatus: 6, errorMsg: null });
      settleCancel(id);
      return { done: true, message: "已取消，费用已退回账户余额" };
    }
    // 客户自己申请：接口取消失败时不改状态（面单照常有效），只留一条记录给后台看
    if (opts.markOnFail === false) {
      updateShipment(id, { errorMsg: `客户申请取消，接口取消未成功：${(e as Error).message}` });
      return { done: false, message: (e as Error).message };
    }
    updateShipment(id, {
      status: "cancel_requested",
      errorMsg: `接口取消未成功：${(e as Error).message}。请联系 ${providerOf(cur.channelCode)} 人工取消，完成后点“确认已取消”。`,
    });
    return { done: false, message: `已标记为取消处理中，请联系 ${providerOf(cur.channelCode)} 人工取消` };
  }
}

export function confirmCancelled(id: number, cancelFee: number, sbCancelFee: number) {
  const s = getShipment(id);
  if (!s) throw new Error("记录不存在");
  if (s.status !== "cancel_requested") throw new Error("这张面单不在取消处理中");
  // 已经退过款的（例如另一次取消已经成功）：不能再按新的手续费改记录，否则记录和实际退款对不上
  if (hasCancelRefund(id)) throw new Error("这张面单已经退过款了，请刷新页面查看最新状态");
  if (!Number.isFinite(cancelFee) || cancelFee < 0 || cancelFee > s.price) throw new Error("客户取消手续费要在 0 到客户价之间");
  if (!Number.isFinite(sbCancelFee) || sbCancelFee < 0) throw new Error("服务商取消费不能是负数");
  updateShipment(id, { ...cancelPatch(s, true, { cancelFee, sbCancelFee }), sbStatus: 6, errorMsg: null });
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
    sbCancelFee: isDhlCode(s.channelCode) ? 0 : round2(((s.actualCost ?? s.quotedCost) * st.sbCancelFeePercent) / 100),
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

export async function resubmitShipment(input: Omit<CreateInput, "customerId"> & { oldId: number }): Promise<ResubmitResult> {
  const old = getShipment(input.oldId);
  if (!old) throw new Error("记录不存在");
  // 出单异常的单，或者已经取消的单（取消后想改信息 / 换单号重新打）
  if (old.status !== "exception" && old.status !== "cancelled") throw new Error("只有出单异常或已取消的订单可以重新下单");
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
      createdBy: input.createdBy ?? "admin",
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
  logProviderEvent(old.customNo, "系统", old.status === "cancelled" ? "取消后重新下单" : "修改后重新下单", null, `新单 ${fresh.customNo}`);
  // 同一订单号的：下新单时已经顺带把原单关掉了
  if (getShipment(old.id)!.status === "cancelled") return { id, old: "cancelled" };

  const provider = providerOf(old.channelCode);
  try {
    await clientFor(old).cancelOrder(old.orderNo ? { orderNo: old.orderNo } : { customNo: old.customNo });
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
  // 嘉谷超时转异常、自动作废没成功的单：继续盯 2 天，面单迟到了能及时处理（换单重下的自动作废）
  const watched = (
    db()
      .prepare(
        `SELECT id FROM shipments WHERE status = 'exception' AND channel_code LIKE 'JG-%' AND COALESCE(sb_status, 2) = 2
         AND created_at >= datetime('now', '-2 days') ORDER BY id DESC LIMIT 30`,
      )
      .all() as { id: number }[]
  ).map((r) => r.id);
  for (const id of [...ids, ...watched]) await refreshShipment(id).catch(() => null);
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
      // 电商店铺：出单后回传运单号、定时同步未发货订单
      const stores = await import("./stores");
      await stores.pushPendingFulfillments().catch(() => null);
      await stores.autoSyncStores().catch(() => null);
    } finally {
      busy = false;
    }
  }, intervalMs);
  sweeper.__atrSweeper.unref?.();
}
