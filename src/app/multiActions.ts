"use server";

/**
 * 多箱寄出（一票多箱寄同一个地址：UPS HWT / FedEx MWT）：报价、下单。
 * 后台（管理员 / 员工代客户下单）和客户 OMS 共用，按登录身份区分。
 */
import { revalidatePath } from "next/cache";
import { currentAdmin, customerDenied, impersonatedCustomerId, portalActor, requireCustomer } from "@/lib/auth";
import { getCustomer } from "@/lib/db";
import { InsufficientBalanceError } from "@/lib/ledger";
import { publicError } from "@/lib/portal";
import { cleanRequest, n, str } from "@/lib/sanitize";
import { createLabel, PriceChangedError, quoteMulti, quoteMultiForProspect, validateRequest } from "@/lib/service";
import { ShipBestError } from "@/lib/shipbest/client";
import { displayChannel } from "@/lib/channelDisplay";
import { tMsg, getT } from "@/lib/prefs";
import { hasAcceptedTerms } from "@/lib/terms";
import type { ShipmentRequest } from "@/lib/shipbest/types";
import { multiEnabled } from "@/lib/multiAccess";
import { negativeRule } from "@/lib/markup";
import type { PartialRule } from "@/lib/pricing";
import { staffProspectMarkupError } from "@/lib/quoteStream";

export interface MultiQuote {
  channelCode: string;
  channelName: string;
  ok: boolean;
  error?: string;
  price?: number;
  currency?: string;
  zone?: string | null;
  /** 会多收钱的提醒（例如超重 / 超尺寸箱子的附加费） */
  warning?: string;
  /** 公司成本：主管理员看得到；运费试算里员工也看得到 */
  cost?: number;
  /** 利润（只在运费试算里给） */
  profit?: number;
}

/** 谁在操作：后台登录的人（要指定客户）或客户自己 */
async function who(customerId?: number): Promise<{ customerId: number; admin: boolean; showCost: boolean } | { error: string }> {
  if (customerId) {
    const a = await currentAdmin();
    if (!a) return { error: "请先登录" };
    const denied = customerDenied(a, customerId, "edit");
    if (denied) return { error: denied };
    if (!getCustomer(customerId)) return { error: "客户不存在" };
    return { customerId, admin: true, showCost: a.role === "owner" };
  }
  const me = await requireCustomer();
  if (!multiEnabled(me.id)) return { error: "多箱寄出还没有开放，请联系客服" };
  return { customerId: me.id, admin: false, showCost: false };
}

export async function multiQuoteAction(input: { customerId?: number; req: ShipmentRequest }): Promise<{ errors?: string[]; quotes?: MultiQuote[] }> {
  const w = await who(Number(input.customerId) || undefined);
  if ("error" in w) return { errors: [await tMsg(w.error)] };
  const req = cleanRequest(input.req);
  if (!req.pkg.pieces?.length) return { errors: [await tMsg("请填写箱规和箱数")] };
  const bad = validateRequest(req, { forQuote: true });
  if (bad.length) return { errors: await Promise.all(bad.map((m) => tMsg(m))) };
  try {
    const list = await quoteMulti(w.customerId, req);
    const quotes: MultiQuote[] = [];
    for (const q of list) {
      quotes.push({
        channelCode: q.channelCode,
        channelName: displayChannel(q.channelCode).name || q.channelName,
        ok: q.ok,
        // 渠道要求不满足的原因照原样给（是我们自己的规则）；服务商的报错给客户看时只说大类
        error: q.ok ? undefined : await tMsg(w.admin ? q.error ?? "" : publicError(q.error)),
        price: q.price,
        currency: q.currency,
        zone: q.zone,
        ...(q.ok && q.warning ? { warning: await tMsg(q.warning) } : {}),
        ...(w.showCost && q.ok ? { cost: q.cost } : {}),
      });
    }
    return { quotes };
  } catch (e) {
    return { errors: [await tMsg(publicError((e as Error).message))] };
  }
}

/**
 * 运费试算（后台，不出单）里的多箱试算：主管理员和员工都能用，和普通试算一样看公司成本和利润。
 * customerId 不填 / 0 = 还没开户的新客户：用所有已启用的多箱渠道、按临时填写的加价试算（员工填的加价不能低于全局默认）。
 * 选了客户：按这个客户开通的多箱渠道和他的加价算（员工只能选授权给他的客户，查看权限就够）。
 */
export async function multiTrialQuoteAction(input: { customerId?: number; markup?: PartialRule; req: ShipmentRequest }): Promise<{ errors?: string[]; quotes?: MultiQuote[] }> {
  const fail = async (m: string) => ({ errors: [await tMsg(m)] });
  const a = await currentAdmin();
  if (!a) return fail("请先登录后台");
  const customerId = Number(input.customerId) || 0;
  if (customerId) {
    const denied = customerDenied(a, customerId, "view");
    if (denied) return fail(denied);
    if (!getCustomer(customerId)) return fail("客户不存在");
  }
  // 临时加价：留空 = 按全局 / 渠道设置；填了要是数字
  const m: PartialRule = { percent: null, fixed: null, minProfit: null };
  if (!customerId) {
    for (const k of ["percent", "fixed", "minProfit"] as const) {
      const v = input.markup?.[k];
      if (v === null || v === undefined) continue;
      if (typeof v !== "number" || !Number.isFinite(v)) return fail("加价要填数字");
      m[k] = v;
    }
    const neg = negativeRule(m);
    if (neg) return fail(neg);
    if (a.role === "staff") {
      const low = staffProspectMarkupError(m);
      if (low) return fail(low);
    }
  }
  const req = cleanRequest(input.req);
  if (!req.pkg.pieces?.length) return fail("请填写箱规和箱数");
  const bad = validateRequest(req, { forQuote: true });
  if (bad.length) return { errors: await Promise.all(bad.map((x) => tMsg(x))) };
  try {
    const list = customerId ? await quoteMulti(customerId, req) : await quoteMultiForProspect(req, m);
    const quotes: MultiQuote[] = [];
    for (const q of list) {
      quotes.push({
        channelCode: q.channelCode,
        channelName: displayChannel(q.channelCode).name || q.channelName,
        ok: q.ok,
        error: q.ok ? undefined : await tMsg(q.error ?? ""),
        price: q.price,
        currency: q.currency,
        zone: q.zone,
        ...(q.ok && q.warning ? { warning: await tMsg(q.warning) } : {}),
        ...(q.ok ? { cost: q.cost, profit: q.profit } : {}),
      });
    }
    return { quotes };
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function multiCreateAction(input: {
  customerId?: number;
  channelCode: string;
  req: ShipmentRequest;
  expectedPrice: number;
  customerRef?: string;
  remark?: string;
}): Promise<{ id?: number; error?: string; newPrice?: number }> {
  const w = await who(Number(input.customerId) || undefined);
  if ("error" in w) return { error: await tMsg(w.error) };
  // 客户自己下单要先同意服务条款（管理员代操作除外）
  if (!w.admin && !(await impersonatedCustomerId()) && !hasAcceptedTerms(w.customerId)) return { error: await tMsg("请先阅读并同意服务条款") };
  try {
    const id = await createLabel({
      customerId: w.customerId,
      channelCode: str(input.channelCode),
      req: cleanRequest(input.req),
      expectedPrice: n(input.expectedPrice),
      customerRef: str(input.customerRef, 50) || undefined,
      remark: str(input.remark, 200) || undefined,
      createdBy: w.admin ? "admin" : await portalActor(),
    });
    revalidatePath(w.admin ? "/shipments" : "/portal");
    return { id };
  } catch (e) {
    if (e instanceof PriceChangedError) return { error: await tMsg(e.message), newPrice: e.quote.price };
    if (e instanceof InsufficientBalanceError) return { error: await tMsg(e.message) };
    if (e instanceof ShipBestError) return { error: (await getT())("下单失败：{reason}", { reason: await tMsg(w.admin ? e.message : publicError(e.message)) }) };
    return { error: await tMsg(w.admin ? (e as Error).message : publicError((e as Error).message)) };
  }
}
