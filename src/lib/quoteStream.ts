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
import { getShipment, houseCustomerId } from "./db";
import { translateMessage, type Lang } from "./i18n";
import { negativeRule } from "./markup";
import type { PartialRule } from "./pricing";
import { publicError, toPublicQuote } from "./portal";
import { cleanRequest } from "./sanitize";
import { quoteAll, quoteForProspect, validateRequest, withQuoteSkus, type ChannelQuote, type QuoteHooks } from "./service";
import type { ShipmentRequest } from "./shipbest/types";

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

  /* ---------- 后台运费试算（员工也能用，只看客户价） ---------- */
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
    const shape = (q: ChannelQuote) => (admin.role === "staff" ? ({ ...q, cost: undefined, listCost: undefined, profit: undefined, ms: undefined }) : q);
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
