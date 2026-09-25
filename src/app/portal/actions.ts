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
import { getCustomerLogin, getPasswordHash, getSettings, setCustomerPassword, setCustomerSender, setLabelNote } from "@/lib/db";
import { InsufficientBalanceError } from "@/lib/ledger";
import { ownsShipment, publicError, toPublicQuote, type PublicQuote } from "@/lib/portal";
import { cleanAddress, cleanRequest, n, str } from "@/lib/sanitize";
import { createLabel, PriceChangedError, quoteAll, refreshShipment, validateRequest } from "@/lib/service";
import { ShipBestError } from "@/lib/shipbest/client";
import { createTopup, getTopup } from "@/lib/topup";
import { requestReset, resetWithToken } from "@/lib/passwordReset";
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

// 已付款出单的订单客户不能自己取消，需要联系客服在后台处理（见面单详情页提示）。

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

/** 客户修改自己面单上加印的文字 */
export async function portalSaveLabelNoteAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const me = await requireCustomer();
  const id = Number(fd.get("id"));
  if (!ownsShipment(me.id, id)) return { error: "面单不存在" };
  setLabelNote(id, str(fd.get("labelNote"), 200) || null);
  revalidatePath(`/portal/shipments/${id}`);
  return { ok: "已保存，重新打开面单即可看到" };
}

/** 客户提交充值申请 */
export async function portalTopupAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const me = await requireCustomer();
  const method = fd.get("method") === "alipay" ? "alipay" : "zelle";
  const file = fd.get("proof");
  if (file instanceof File && file.size > 5 * 1024 * 1024) return { error: "凭证文件不能超过 5MB" };
  try {
    const id = await createTopup({
      customerId: me.id,
      method,
      amountUsd: n(fd.get("amountUsd")),
      reference: str(fd.get("reference"), 100),
      note: str(fd.get("note"), 300),
      proof: file instanceof File && file.size ? Buffer.from(await file.arrayBuffer()) : null,
      quotedRate: n(fd.get("quotedRate")) || null,
    });
    revalidatePath("/portal/topup");
    const t = getTopup(id);
    const paid = t && t.payCurrency === "CNY" ? `（¥${t.payAmount.toFixed(2)}，汇率 ${t.fxRate}）` : "";
    return { ok: `充值申请 #${id} 已提交${paid}，我们确认到账后会加到账户余额。` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ---------------- 忘记密码 ---------------- */

export async function portalForgotAction(_: unknown, fd: FormData) {
  const email = str(fd.get("email"), 100).toLowerCase();
  const key = `forgot:${await clientIp()}`;
  const limited = checkRateLimit(key);
  if (limited) return { error: limited };
  recordFailure(key); // 每次申请都计数，防止被刷
  if (!email) return { error: "请填写登录邮箱" };
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const r = await requestReset(email, base);
  return {
    ok: r.emailed
      ? "如果这个邮箱已开通账号，我们已发送重置密码的链接，请在 1 小时内查收邮件。"
      : `已收到你的申请。客服会在工作时间内（一般 1 个工作日内）为你重置密码，并通过你登记的联系方式告知新密码。${
          getSettings().supportContact ? `着急的话可以直接联系：${getSettings().supportContact}` : ""
        }`,
  };
}

export async function portalResetAction(_: unknown, fd: FormData) {
  const token = str(fd.get("token"), 100);
  const pw = String(fd.get("password") ?? "");
  if (pw !== String(fd.get("confirm") ?? "")) return { error: "两次输入的密码不一致" };
  try {
    const id = resetWithToken(token, pw);
    await createCustomerSession(id, getPasswordHash(id)!);
  } catch (e) {
    return { error: (e as Error).message };
  }
  redirect("/portal");
}
