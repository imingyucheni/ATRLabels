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
  portalActor,
  impersonatedCustomerId,
  leaveCustomer,
} from "@/lib/auth";
import { adminOrigin } from "@/lib/sites";
import { usStateCode } from "@/lib/geo";
import { isPaperSize, PAPER_LABEL } from "@/lib/labelLayout";
import { deleteSender, listSenders, saveSender, setDefaultSender } from "@/lib/senders";
import { activeShipmentByRef, duplicateRefMessage, getCustomerLogin, getPasswordHash, getSettings, getShipment, setCustomerLabelPaper, setCustomerPassword, setCustomerSender, setLabelNote } from "@/lib/db";
import { InsufficientBalanceError } from "@/lib/ledger";
import { cancelWindowHours, cancelWindowPassed, ownsShipment, publicError, toPublicQuote, type PublicQuote } from "@/lib/portal";
import { cleanAddress, cleanRequest, n, str } from "@/lib/sanitize";
import { createLabel, PriceChangedError, quoteAll, refreshShipment, requestCancel, validateRequest } from "@/lib/service";
import { ShipBestError } from "@/lib/shipbest/client";
import { createTopup, getTopup } from "@/lib/topup";
import { requestReset, resetWithToken } from "@/lib/passwordReset";
import type { Address, ShipmentRequest } from "@/lib/shipbest/types";
import type { FlashState } from "@/app/actions";
import { getT, tMsg } from "@/lib/prefs";
import { NOTIFY_EVENTS, saveNotifyPrefs, type NotifyPrefs } from "@/lib/notify";
import { checkAddress, needsAck, type AddressCheck } from "@/lib/addressCheck";

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
  if (limited) return { error: await tMsg(limited), email };
  const c = email ? getCustomerLogin(email) : null;
  if (!c || !c.enabled || !verifyPassword(password, c.passwordHash)) {
    recordFailure(key);
    return { error: await tMsg("邮箱或密码错误，或账号未开通"), email };
  }
  clearFailures(key);
  await createCustomerSession(c.id, c.passwordHash!);
  redirect("/portal");
}

export async function portalLogoutAction() {
  // 管理员代操作时“退出”= 结束代操作，回到后台这个客户的页面
  const as = await impersonatedCustomerId();
  if (as) return leaveCustomerAction();
  await destroyCustomerSession();
  redirect("/portal/login");
}

export async function leaveCustomerAction() {
  const as = await impersonatedCustomerId();
  await leaveCustomer();
  redirect(`${adminOrigin()}${as ? `/customers/${as}` : "/customers"}`);
}

/* ---------------- 报价 / 下单 ---------------- */

export async function portalQuoteAction(raw: ShipmentRequest): Promise<{ errors?: string[]; quotes?: PublicQuote[]; address?: AddressCheck }> {
  const me = await requireCustomer();
  const req = cleanRequest(raw);
  const errors = validateRequest(req);
  if (errors.length) return { errors: await Promise.all(errors.map((m) => tMsg(m))) };
  try {
    // 报价和地址核对同时进行
    const [all, address] = await Promise.all([quoteAll(me.id, req), checkAddress(req.recipient)]);
    const quotes = all.map(toPublicQuote);
    // 渠道不可用的原因按界面语言显示
    for (const q of quotes) if (q.error) q.error = await tMsg(q.error);
    if (address.message) address.message = await tMsg(address.message);
    return { quotes, address };
  } catch (e) {
    return { errors: [await tMsg(publicError((e as Error).message))] };
  }
}

export async function portalCreateAction(input: {
  channelCode: string;
  req: ShipmentRequest;
  expectedPrice: number;
  customerRef?: string;
  remark?: string;
  /** 客户已确认有问题的收件地址无误 */
  addressAck?: boolean;
}): Promise<{ id?: number; error?: string; quote?: PublicQuote; needAddressAck?: boolean }> {
  const me = await requireCustomer();
  try {
    // 订单号重复的先拦下（不用再去核对地址）
    const ref = str(input.customerRef, 50);
    const dupe = ref ? activeShipmentByRef(me.id, ref) : undefined;
    if (dupe) return { error: await tMsg(duplicateRefMessage(ref, dupe)) };
    // 地址有问题（查不到 / 缺公寓号）时必须客户确认过才能下单
    const address = await checkAddress(cleanRequest(input.req).recipient);
    if (needsAck(address) && !input.addressAck) {
      return { error: await tMsg("收件地址可能有问题，请检查地址，或勾选“我确认地址无误”后再下单"), needAddressAck: true };
    }
    const id = await createLabel({
      addressCheck: needsAck(address) ? { ...address, acknowledged: true } as AddressCheck : address,
      customerId: me.id,
      channelCode: str(input.channelCode),
      req: cleanRequest(input.req),
      expectedPrice: n(input.expectedPrice),
      customerRef: str(input.customerRef, 50) || undefined,
      remark: str(input.remark, 200) || undefined,
      createdBy: await portalActor(),
    });
    revalidatePath("/portal");
    return { id };
  } catch (e) {
    if (e instanceof PriceChangedError) return { error: await tMsg(e.message), quote: toPublicQuote(e.quote) };
    if (e instanceof InsufficientBalanceError) return { error: await tMsg(e.message) };
    if (e instanceof ShipBestError) return { error: (await getT())("下单失败：{reason}", { reason: await tMsg(publicError(e.message)) }) };
    return { error: await tMsg(publicError((e as Error).message)) };
  }
}

/* ---------------- 面单操作 ---------------- */

export async function portalRefreshAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const me = await requireCustomer();
  const id = Number(fd.get("id"));
  if (!ownsShipment(me.id, id)) return { error: await tMsg("面单不存在") };
  try {
    const s = await refreshShipment(id);
    revalidatePath(`/portal/shipments/${id}`);
    return { ok: await tMsg(s.labelPath ? "面单已生成" : "状态已更新，面单还在生成中") };
  } catch {
    return { error: await tMsg("刷新失败，请稍后再试") };
  }
}

/**
 * 客户申请取消：和后台“申请取消”走同一个流程（requestCancel）——先尝试接口取消，
 * 接口取消不了时标记为“取消处理中”，由员工在后台跟 ShipBest 人工取消后确认。
 */
export async function portalCancelAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const me = await requireCustomer();
  const id = Number(fd.get("id"));
  if (!ownsShipment(me.id, id)) return { error: await tMsg("面单不存在") };
  const s = getShipment(id);
  if (!s || (s.status !== "pending" && s.status !== "labeled")) return { error: await tMsg("这张面单当前不能申请取消") };
  if (cancelWindowPassed(s.createdAt)) return { error: (await getT())("下单已超过 {h} 小时，不能再取消", { h: cancelWindowHours() }) };
  const contact = getSettings().supportContact;
  const failed = async () => {
    const t = await getT();
    return { error: contact ? t("取消失败，请联系客服：{contact}", { contact }) : t("取消失败，请联系客服") };
  };
  try {
    // 接口取消成功才算取消；失败就告诉客户联系客服（面单保持有效）
    const r = await requestCancel(id, { markOnFail: false });
    revalidatePath(`/portal/shipments/${id}`);
    revalidatePath("/portal", "layout");
    if (!r.done) return failed();
    return { ok: await tMsg("已取消，费用已退回账户余额") };
  } catch {
    return failed();
  }
}

/* ---------------- 账户 ---------------- */

/* ---------------- 寄件地址簿 ---------------- */

export async function saveSenderBookAction(input: { id?: number; label?: string; address: Partial<Address>; makeDefault?: boolean }) {
  const me = await requireCustomer();
  const address = cleanAddress(input.address);
  const errs: string[] = [];
  if (!address.nameFirst || !address.nameLast) errs.push("姓名");
  if (!address.address1) errs.push("地址1");
  if (!address.city) errs.push("城市");
  if (!address.zipCode) errs.push("邮编");
  // 美国地址必须有州（面单和报价都要用），并且是有效的州
  if (address.country === "US" && !usStateCode(address.province ?? "")) errs.push("州");
  if (errs.length) {
    const t = await getT();
    return { error: t("请填写：{fields}", { fields: errs.map((x) => t(x)).join(t("、")) }) };
  }
  try {
    const id = saveSender(me.id, { id: input.id ? Number(input.id) : undefined, label: str(input.label, 50), address, makeDefault: !!input.makeDefault });
    revalidatePath("/portal/account");
    revalidatePath("/portal/ship");
    return { id, senders: listSenders(me.id) };
  } catch (e) {
    return { error: await tMsg((e as Error).message) };
  }
}

export async function setDefaultSenderAction(id: number) {
  const me = await requireCustomer();
  setDefaultSender(me.id, Number(id));
  revalidatePath("/portal/account");
  return { senders: listSenders(me.id) };
}

export async function deleteSenderAction(id: number) {
  const me = await requireCustomer();
  deleteSender(me.id, Number(id));
  revalidatePath("/portal/account");
  return { senders: listSenders(me.id) };
}

export async function portalChangePasswordAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const me = await requireCustomer();
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("next") ?? "");
  if (!verifyPassword(current, getPasswordHash(me.id))) return { error: await tMsg("当前密码不正确") };
  if (next.length < 8) return { error: await tMsg("新密码至少 8 位") };
  if (next !== String(fd.get("confirm") ?? "")) return { error: await tMsg("两次输入的新密码不一致") };
  const hash = hashPassword(next);
  setCustomerPassword(me.id, hash);
  // 改密码后旧会话失效，用新密码重新签发
  await createCustomerSession(me.id, hash);
  return { ok: await tMsg("密码已修改") };
}

/** 客户修改自己面单上加印的文字 */
export async function portalSaveLabelNoteAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const me = await requireCustomer();
  const id = Number(fd.get("id"));
  if (!ownsShipment(me.id, id)) return { error: await tMsg("面单不存在") };
  setLabelNote(id, str(fd.get("labelNote"), 200) || null);
  revalidatePath(`/portal/shipments/${id}`);
  return { ok: await tMsg("已保存，重新打开面单即可看到") };
}

/** 客户提交充值申请 */
export async function portalTopupAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const me = await requireCustomer();
  const method = fd.get("method") === "alipay" ? "alipay" : "zelle";
  const file = fd.get("proof");
  if (file instanceof File && file.size > 5 * 1024 * 1024) return { error: await tMsg("凭证文件不能超过 5MB") };
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
    const tr = await getT();
    const paid = t && t.payCurrency === "CNY" ? tr("（¥{amount}，汇率 {rate}）", { amount: t.payAmount.toFixed(2), rate: t.fxRate }) : "";
    return { ok: tr("充值申请 #{id} 已提交{paid}，我们确认到账后会加到账户余额。", { id, paid }) };
  } catch (e) {
    return { error: await tMsg((e as Error).message) };
  }
}

/* ---------------- 忘记密码 ---------------- */

export async function portalForgotAction(_: unknown, fd: FormData) {
  const email = str(fd.get("email"), 100).toLowerCase();
  const key = `forgot:${await clientIp()}`;
  const limited = checkRateLimit(key);
  if (limited) return { error: await tMsg(limited) };
  recordFailure(key); // 每次申请都计数，防止被刷
  if (!email) return { error: await tMsg("请填写登录邮箱") };
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const r = await requestReset(email, base);
  const t = await getT();
  return {
    ok: r.emailed
      ? t("如果这个邮箱已开通账号，我们已发送重置密码的链接，请在 1 小时内查收邮件。")
      : `${t("已收到你的申请。客服会在工作时间内（一般 1 个工作日内）为你重置密码，并通过你登记的联系方式告知新密码。")}${
          getSettings().supportContact ? t("着急的话可以直接联系：{contact}", { contact: getSettings().supportContact }) : ""
        }`,
  };
}

export async function portalResetAction(_: unknown, fd: FormData) {
  const token = str(fd.get("token"), 100);
  const pw = String(fd.get("password") ?? "");
  if (pw !== String(fd.get("confirm") ?? "")) return { error: await tMsg("两次输入的密码不一致") };
  try {
    const id = resetWithToken(token, pw);
    await createCustomerSession(id, getPasswordHash(id)!);
  } catch (e) {
    return { error: await tMsg((e as Error).message) };
  }
  redirect("/portal");
}

export async function portalSaveNotifyAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const me = await requireCustomer();
  const email = str(fd.get("notifyEmail"), 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: await tMsg("邮箱格式不正确") };
  const low = Math.max(0, Math.min(100000, Number(fd.get("lowBalance")) || 0));
  const events = Object.fromEntries(NOTIFY_EVENTS.map((e) => [e, fd.get(`ev.${e}`) === "on"])) as NotifyPrefs["events"];
  saveNotifyPrefs(me.id, { events, email, lowBalance: low });
  revalidatePath("/portal/account");
  return { ok: await tMsg("通知设置已保存") };
}

export async function portalSaveLabelPaperAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const me = await requireCustomer();
  const v = fd.get("labelPaper");
  if (!isPaperSize(v)) return { error: await tMsg("请选择纸张") };
  setCustomerLabelPaper(me.id, v);
  revalidatePath("/portal", "layout");
  const t = await getT();
  return { ok: t("已保存：之后打印 / 下载面单使用 {paper}", { paper: t(PAPER_LABEL[v]) }) };
}
