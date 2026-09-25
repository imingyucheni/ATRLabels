"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  checkRateLimit,
  clearFailures,
  createCustomerSession,
  destroyCustomerSession,
  hashPassword,
  recordFailure,
  requireCustomer,
  verifyPassword,
} from "@/lib/auth";
import { getCustomerLogin, getPasswordHash, setCustomerPassword, setCustomerSender } from "@/lib/db";
import { InsufficientBalanceError } from "@/lib/ledger";
import { ownsShipment, publicError, toPublicQuote, type PublicQuote } from "@/lib/portal";
import { cleanAddress, cleanRequest, n, str } from "@/lib/sanitize";
import { createLabel, PriceChangedError, quoteAll, refreshShipment, requestCancel, validateRequest } from "@/lib/service";
import { ShipBestError } from "@/lib/shipbest/client";
import type { Address, ShipmentRequest } from "@/lib/shipbest/types";
import type { FlashState } from "@/app/actions";

async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "local";
}

/* ---------------- 登录 ---------------- */

export async function portalLoginAction(_: unknown, fd: FormData) {
  const email = str(fd.get("email")).toLowerCase();
  const password = String(fd.get("password") ?? "");
  const key = `portal:${email}:${await clientIp()}`;
  const limited = checkRateLimit(key);
  if (limited) return { error: limited, email };
  const c = email ? getCustomerLogin(email) : null;
  if (!c || !c.enabled || !verifyPassword(password, c.passwordHash)) {
    recordFailure(key);
    return { error: "邮箱或密码错误，或账号未开通", email };
  }
  clearFailures(key);
  await createCustomerSession(c.id, c.passwordHash!);
  redirect("/portal");
}

export async function portalLogoutAction() {
  await destroyCustomerSession();
  redirect("/portal/login");
}

/* ---------------- 报价 / 下单 ---------------- */

export async function portalQuoteAction(raw: ShipmentRequest): Promise<{ errors?: string[]; quotes?: PublicQuote[] }> {
  const me = await requireCustomer();
  const req = cleanRequest(raw);
  const errors = validateRequest(req);
  if (errors.length) return { errors };
  try {
    return { quotes: (await quoteAll(me.id, req)).map(toPublicQuote) };
  } catch (e) {
    return { errors: [publicError((e as Error).message)] };
  }
}

export async function portalCreateAction(input: {
  channelCode: string;
  req: ShipmentRequest;
  expectedPrice: number;
  customerRef?: string;
  remark?: string;
}): Promise<{ id?: number; error?: string; quote?: PublicQuote }> {
  const me = await requireCustomer();
  try {
    const id = await createLabel({
      customerId: me.id,
      channelCode: str(input.channelCode),
      req: cleanRequest(input.req),
      expectedPrice: n(input.expectedPrice),
      customerRef: str(input.customerRef, 50) || undefined,
      remark: str(input.remark, 200) || undefined,
      createdBy: "customer",
    });
    revalidatePath("/portal");
    return { id };
  } catch (e) {
    if (e instanceof PriceChangedError) return { error: e.message, quote: toPublicQuote(e.quote) };
    if (e instanceof InsufficientBalanceError) return { error: e.message };
    if (e instanceof ShipBestError) return { error: `下单失败：${publicError(e.message)}` };
    return { error: publicError((e as Error).message) };
  }
}

/* ---------------- 面单操作 ---------------- */

export async function portalRefreshAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const me = await requireCustomer();
  const id = Number(fd.get("id"));
  if (!ownsShipment(me.id, id)) return { error: "面单不存在" };
  try {
    const s = await refreshShipment(id);
    revalidatePath(`/portal/shipments/${id}`);
    return { ok: s.labelPath ? "面单已生成" : "状态已更新，面单还在生成中" };
  } catch {
    return { error: "刷新失败，请稍后再试" };
  }
}

export async function portalCancelAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const me = await requireCustomer();
  const id = Number(fd.get("id"));
  if (!ownsShipment(me.id, id)) return { error: "面单不存在" };
  try {
    const r = await requestCancel(id);
    revalidatePath(`/portal/shipments/${id}`);
    return r.done ? { ok: r.message } : { ok: "已提交取消申请，我们处理完成后会把费用退回你的账户余额" };
  } catch {
    return { error: "取消失败，请联系客服" };
  }
}

/* ---------------- 账户 ---------------- */

export async function portalSaveSenderAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const me = await requireCustomer();
  const sender = cleanAddress(
    Object.fromEntries([...fd.entries()].filter(([k]) => k.startsWith("sender.")).map(([k, v]) => [k.slice(7), v])) as Partial<Address>,
  );
  setCustomerSender(me.id, sender.nameFirst || sender.address1 ? sender : null);
  revalidatePath("/portal/account");
  return { ok: "默认寄件地址已保存" };
}

export async function portalChangePasswordAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const me = await requireCustomer();
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("next") ?? "");
  if (!verifyPassword(current, getPasswordHash(me.id))) return { error: "当前密码不正确" };
  if (next.length < 8) return { error: "新密码至少 8 位" };
  if (next !== String(fd.get("confirm") ?? "")) return { error: "两次输入的新密码不一致" };
  const hash = hashPassword(next);
  setCustomerPassword(me.id, hash);
  // 改密码后旧会话失效，用新密码重新签发
  await createCustomerSession(me.id, hash);
  return { ok: "密码已修改" };
}
