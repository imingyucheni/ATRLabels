/**
 * 边查边报（下单页的“查询运费”）：每个渠道查完马上发给页面，不用等最慢的那家；
 * 收件地址核对单独发，不拖住报价。最后再发一次整理好的完整列表（补分区、排序）。
 *
 * 逻辑和原来的几个报价 action（客户 OMS / 后台运费试算 / 管理员下单 / 异常单重新下单）一样，
 * 登录检查在 /api/quote/stream 里做，这里只管查价和整理。
 */
import { checkAddress, type AddressCheck } from "./addressCheck";
import type { AdminPrincipal } from "./adminSession";
import { customerAccess } from "./adminSession";
import { displayChannel } from "./channelDisplay";
import { getSettings, getShipment, houseCustomerId, isInternalCustomer } from "./db";
import { translateMessage, type Lang } from "./i18n";
import { negativeRule } from "./markup";
import type { PartialRule } from "./pricing";
import { publicError, toPublicQuote } from "./portal";
import { cleanRequest } from "./sanitize";
import { quoteAll, quoteForProspect, validateRequest, withQuoteSkus, type ChannelQuote, type QuoteHooks } from "./service";
import type { ShipmentRequest } from "./shipbest/types";
import { setInternalCustomerCheck } from "./staffStore";

// 员工权限里要排除公司自用账户（成本价）：staffStore 不打开数据库，在这里告诉它怎么判断（auth.ts 里也注册了）
setInternalCustomerCheck(isInternalCustomer);

/**
 * 员工给还没开户的新客户试算时看到的报价：只有客户价（和限时活动的活动名、原价）。
 * 成本、原价、利润、用时、加价规则都不给：知道规则和客户价就能倒推出成本。
 * （员工自己负责 / 授权的客户可以看全部数据，包括成本和利润，见 runQuoteStream）
 */
export function staffQuote(q: ChannelQuote): Omit<ChannelQuote, "cost" | "listCost" | "profit" | "ms" | "rule"> {
  const { cost: _c, listCost: _l, profit: _p, ms: _m, rule: _r, ...rest } = q;
  void [_c, _l, _p, _m, _r];
  return rest;
}

export const STAFF_PROSPECT_MARKUP_ERROR = "员工试算新客户时，临时加价不能低于全局默认加价（留空 = 按全局默认）";

/**
 * 员工给还没开户的新客户试算：填了的临时加价（加价 %、固定加价、最低利润）每一项都不能低于全局默认，
 * 不然填 0 / 0 / 0 试算出来的“客户价”就是成本价。留空的照旧沿用全局 / 渠道设置。
 */
export function staffProspectMarkupError(m: PartialRule): string | null {
  const g = getSettings().markup;
  for (const k of ["percent", "fixed", "minProfit"] as const) {
    const v = m[k];
    if (v === null || v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < (g[k] ?? 0)) return STAFF_PROSPECT_MARKUP_ERROR;
  }
  return null;
}

export type QuoteMode = "portal" | "admin" | "house" | "resubmit";

export interface QuoteStreamInput {
  mode: QuoteMode;
  /** admin：选的客户（0 = 还没开户的新客户，按临时加价试算） */
  customerId?: number;
  /** resubmit：原订单 */
  oldId?: number;
  /** admin 新客户试算的临时加价 */
  markup?: PartialRule;
  req: ShipmentRequest;
}

export type QuoteStreamEvent =
  | { t: "start"; channels: { code: string; name: string }[] }
  | { t: "q"; q: unknown }
  | { t: "addr"; a: AddressCheck }
  | { t: "done"; quotes: unknown[] }
  | { t: "err"; errors: string[] };

export type QuoteStreamWho = { kind: "customer"; customerId: number } | { kind: "admin"; admin: AdminPrincipal };

export async function runQuoteStream(who: QuoteStreamWho, input: QuoteStreamInput, emit: (e: QuoteStreamEvent) => void, lang: Lang = "zh"): Promise<void> {
  const tr = (m: string | null | undefined) => translateMessage(lang, m ?? "");
  const fail = (errors: string[]) => emit({ t: "err", errors });

  /* ---------- 客户 OMS ---------- */
  if (input.mode === "portal") {
    if (who.kind !== "customer") return fail(["请先登录"]);
    const req = cleanRequest(input.req);
    const errors = validateRequest(req);
    if (errors.length) return fail(errors.map(tr));
    // 客户看到的：只有客户价，错误只说大类，渠道名用对外名称
    const pub = (q: ChannelQuote) => {
      const p = toPublicQuote(q);
      return p.error ? { ...p, error: tr(p.error) } : p;
    };
    return run(who.customerId, req, true, pub);
  }

  if (who.kind !== "admin") return fail(["请先登录后台"]);
  const admin = who.admin;

  /* ---------- 后台运费试算（员工也能用：自己负责 / 授权的客户看全部数据；新客户试算只看客户价） ---------- */
  if (input.mode === "admin") {
    const customerId = Number(input.customerId) || 0;
    if (customerId && !customerAccess(admin, customerId)) return fail(["你没有这个客户的权限，请找主管理员授权"]);
    // 运费试算只需要地址和包裹：不检查商品明细，缺的用样品补上（出单时仍然严格校验）
    const req = withQuoteSkus(cleanRequest(input.req));
    const errors = validateRequest(req, { forQuote: true });
    if (errors.length) return fail(errors);
    const m: PartialRule = { percent: input.markup?.percent ?? null, fixed: input.markup?.fixed ?? null, minProfit: input.markup?.minProfit ?? null };
    const neg = negativeRule(m);
    if (neg) return fail([neg]);
    if (admin.role === "staff" && !customerId) {
      const low = staffProspectMarkupError(m);
      if (low) return fail([low]);
    }
    // 员工：授权给他的客户看全部数据（成本、利润、加价规则，他要知道自己客户的利润）；新客户试算只看客户价
    const shape = (q: ChannelQuote) => {
      if (admin.role !== "staff") return q;
      if (!customerId) return staffQuote(q);
      const { ms: _ms, ...full } = q;
      void _ms;
      return full;
    };
    return run(customerId, req, false, shape, customerId ? undefined : m);
  }

  // 下面两种只有主管理员能用（看得到成本）
  if (admin.role !== "owner") return fail(["只有主管理员可以这样操作"]);

  /* ---------- 管理员下单（公司自用账户，成本价） ---------- */
  if (input.mode === "house") {
    const req = cleanRequest(input.req);
    const errors = validateRequest(req);
    if (errors.length) return fail(errors);
    return run(houseCustomerId(), req, true, (q) => q);
  }

  /* ---------- 异常单 / 已取消的单修改后重新下单（按原客户的价格） ---------- */
  if (input.mode === "resubmit") {
    const old = getShipment(Number(input.oldId));
    if (!old || (old.status !== "exception" && old.status !== "cancelled") || old.replacedBy) return fail(["只有出单异常或已取消、还没重新下过单的订单可以重新下单"]);
    const req = cleanRequest(input.req);
    const errors = validateRequest(req);
    if (errors.length) return fail(errors);
    return run(old.customerId, req, true, (q) => q);
  }

  return fail(["不支持的报价方式"]);

  /** 查价（边查边发）+ 地址核对（单独发）；最后发整理好的完整列表 */
  async function run(customerId: number, req: ShipmentRequest, withAddress: boolean, shape: (q: ChannelQuote) => unknown, prospectMarkup?: PartialRule) {
    const portal = who.kind === "customer";
    const address = withAddress
      ? checkAddress(req.recipient)
          .then((a) => emit({ t: "addr", a: a.message ? { ...a, message: portal ? tr(a.message) : a.message } : a }))
          .catch(() => null)
      : Promise.resolve();
    const hooks: QuoteHooks = {
      onStart: (channels) => emit({ t: "start", channels: channels.map((c) => ({ code: c.code, name: portal ? displayChannel(c.code).name || c.name : c.name })) }),
      onEach: (q) => emit({ t: "q", q: shape(q) }),
    };
    try {
      const quotes = prospectMarkup ? await quoteForProspect(req, prospectMarkup, hooks) : await quoteAll(customerId, req, hooks);
      emit({ t: "done", quotes: quotes.map(shape) });
    } catch (e) {
      const msg = (e as Error).message;
      fail([portal ? tr(publicError(msg)) : msg]);
    }
    // 地址核对比报价慢时，报价先显示，地址结果随后补上
    await address;
  }
}
