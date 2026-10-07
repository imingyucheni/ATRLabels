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
import { createLabel, PriceChangedError, quoteMulti, validateRequest } from "@/lib/service";
import { ShipBestError } from "@/lib/shipbest/client";
import { displayChannel } from "@/lib/channelDisplay";
import { tMsg, getT } from "@/lib/prefs";
import { hasAcceptedTerms } from "@/lib/terms";
import type { ShipmentRequest } from "@/lib/shipbest/types";
import { multiEnabled } from "@/lib/multiAccess";

export interface MultiQuote {
  channelCode: string;
  channelName: string;
  ok: boolean;
  error?: string;
  price?: number;
  currency?: string;
  zone?: string | null;
  /** 只有主管理员看得到 */
  cost?: number;
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
        ...(w.showCost && q.ok ? { cost: q.cost } : {}),
      });
    }
    return { quotes };
  } catch (e) {
    return { errors: [await tMsg(publicError((e as Error).message))] };
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
