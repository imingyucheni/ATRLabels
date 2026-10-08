"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  checkRateLimit,
  clearFailures,
  clientIp,
  createCustomerSession,
  destroyCustomerSession,
  hashPassword,
  recordFailure,
  requireCustomer,
  verifyPassword,
  portalActor,
  impersonatedCustomerId,
  leaveCustomer,
  currentCustomerId,
} from "@/lib/auth";
import { adminOrigin } from "@/lib/sites";
import { usStateCode } from "@/lib/geo";
import { isPaperSize, PAPER_LABEL } from "@/lib/labelLayout";
import { deleteSender, listSenders, saveSender, setDefaultSender } from "@/lib/senders";
import { activeShipmentByRef, duplicateRefMessage, getCustomer, getCustomerLogin, getPasswordHash, getSettings, getShipment, isInternalCustomer, setCustomerLabelPaper, setCustomerPassword, setCustomerSender, setLabelNote } from "@/lib/db";
import { InsufficientBalanceError } from "@/lib/ledger";
import { cancelWindowHours, cancelWindowPassed, ownsShipment, publicError, toPublicQuote, type PublicQuote } from "@/lib/portal";
import { cleanAddress, cleanRequest, n, str } from "@/lib/sanitize";
import { createLabel, PriceChangedError, refreshShipment, requestCancel, resubmitShipment } from "@/lib/service";
import { ShipBestError } from "@/lib/shipbest/client";
import { createTopup, getTopup } from "@/lib/topup";
import { checkToken, requestReset, resetWithToken } from "@/lib/passwordReset";
import { smtpConfigured } from "@/lib/mailer";
import type { Address, ShipmentRequest } from "@/lib/shipbest/types";
import type { FlashState } from "@/app/actions";
import { deleteMyStore, disconnectStore, getStore, importToBatch, listStores, saveShopifyStore, storesEnabled, syncStore } from "@/lib/stores";
import { getLang, getT, tMsg } from "@/lib/prefs";
import { NOTIFY_EVENTS, saveNotifyPrefs, type NotifyPrefs } from "@/lib/notify";
import { checkAddress, needsAck, type AddressCheck } from "@/lib/addressCheck";
import { acceptTerms, hasAcceptedTerms, partyOf } from "@/lib/terms";


/* ---------------- 登录 ---------------- */

const DUMMY_HASH = hashPassword("dummy-password-for-timing");

export async function portalLoginAction(_: unknown, fd: FormData) {
  // 沙盒站只给内部测试：客户不能用账号密码登录（管理员从后台“进入客户账号”测试客户端）
  if (process.env.APP_ENV === "sandbox" && process.env.SANDBOX_PORTAL_LOGIN !== "1") {
    return { error: await tMsg("这里是内部测试站，客户不能登录。请到正式网址登录。"), email: str(fd.get("email")).toLowerCase() };
  }
  const email = str(fd.get("email")).toLowerCase();
  const password = String(fd.get("password") ?? "");
  const key = `portal:${email}:${await clientIp()}`;
  // 按 IP（+ 邮箱）限次数：超过了直接拒绝，不再验证密码
  const limited = checkRateLimit(key);
  if (limited) return { error: await tMsg(limited), email };
  // 每个邮箱还记一个总失败次数，但不拿它锁账号：否则别人换着 IP 故意输错就能把客户锁在外面。
  // 密码对的照样能登录，输错的照样记次数
  const c = email ? getCustomerLogin(email) : null;
  // 账号不存在时也算一次密码，响应时间一样，不能借此试出哪些邮箱开了账号
  const ok = verifyPassword(password, c?.passwordHash ?? DUMMY_HASH);
  // 公司自用账户（成本价、不扣余额）不能登录客户 OMS，和账号不存在一样处理
  if (!c || !c.enabled || !c.passwordHash || !ok || isInternalCustomer(c.id)) {
    recordFailure(key);
    recordFailure(`portal:${email}`);
    return { error: await tMsg("邮箱或密码错误，或账号未开通"), email };
  }
  clearFailures(key);
  await createCustomerSession(c.id, c.passwordHash!);
  redirect("/portal");
}

/** 客户同意服务条款：填写签署人姓名和职位（管理员代操作时不能替客户同意） */
export async function acceptTermsAction(input: { signer: string; signerTitle: string; agree: boolean }): Promise<{ error?: string }> {
  const id = await currentCustomerId();
  if (!id) redirect("/portal/login");
  if (await impersonatedCustomerId()) return { error: "管理员代操作时不能替客户同意条款" };
  const signer = str(input.signer, 60);
  const signerTitle = str(input.signerTitle, 60);
  if (!input.agree) return { error: "请勾选同意服务条款" };
  if (!signer || !signerTitle) return { error: "请填写签署人姓名和职位" };
  const h = await headers();
  const c = getCustomer(id)!;
  acceptTerms({
    customerId: id,
    party: partyOf(c),
    signer,
    signerTitle,
    lang: await getLang(),
    ip: await clientIp(),
    userAgent: h.get("user-agent"),
  });
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

/* ---------------- 报价 / 下单（查运费走 /api/quote/stream，见 lib/quoteStream.ts） ---------------- */

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
  // 还没同意服务条款的客户不能下单（管理员代操作除外）
  if (!(await impersonatedCustomerId()) && !hasAcceptedTerms(me.id)) return { error: "请先阅读并同意服务条款" };
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

/** 已取消的订单重新下单（可以改订单号等信息）：新单记在原单的“重新下单”里，批量批次里的这一行换成新单 */
export async function portalReorderAction(input: {
  oldId: number;
  channelCode: string;
  req: ShipmentRequest;
  expectedPrice: number;
  customerRef?: string;
  remark?: string;
  addressAck?: boolean;
}): Promise<{ id?: number; error?: string; quote?: PublicQuote; needAddressAck?: boolean }> {
  const me = await requireCustomer();
  const old = getShipment(Number(input.oldId));
  if (!old || old.customerId !== me.id) return { error: await tMsg("面单不存在") };
  if (old.status !== "cancelled" || old.replacedBy) return { error: await tMsg("只有已取消、还没重新下过单的订单可以重新下单") };
  if (!(await impersonatedCustomerId()) && !hasAcceptedTerms(me.id)) return { error: await tMsg("请先阅读并同意服务条款") };
  try {
    const ref = str(input.customerRef, 50);
    const dupe = ref ? activeShipmentByRef(me.id, ref) : undefined;
    if (dupe) return { error: await tMsg(duplicateRefMessage(ref, dupe)) };
    const req = cleanRequest(input.req);
    const address = await checkAddress(req.recipient);
    if (needsAck(address) && !input.addressAck) {
      return { error: await tMsg("收件地址可能有问题，请检查地址，或勾选“我确认地址无误”后再下单"), needAddressAck: true };
    }
    const r = await resubmitShipment({
      oldId: old.id,
      channelCode: str(input.channelCode),
      req,
      expectedPrice: n(input.expectedPrice),
      customerRef: ref || undefined,
      remark: str(input.remark, 200) || undefined,
      addressCheck: needsAck(address) ? ({ ...address, acknowledged: true } as AddressCheck) : address,
      createdBy: await portalActor(),
    });
    revalidatePath("/portal");
    return { id: r.id };
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
    // 接口能直接取消的马上取消退款；服务商要人工取消的（已出面单的一般都是）转“取消处理中”，
    // 我们找服务商作废后在后台确认，费用再退回
    const r = await requestCancel(id);
    revalidatePath(`/portal/shipments/${id}`);
    revalidatePath("/portal", "layout");
    if (!r.done) return { ok: await tMsg("已提交取消申请，客服处理完成后费用会退回账户余额。请不要再使用这张面单。") };
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
  // 链接地址用服务器配置的网址，不信任请求头（防止被伪造成别的域名骗取重置链接）
  const base = resetLinkBase(await headers());
  // 公司自用账户（成本价）不能登录客户 OMS：不处理，回复和邮箱不存在时一样
  const login = getCustomerLogin(email);
  const internal = !!login && isInternalCustomer(login.id);
  // 要发邮件、却没有可信的网址：不发链接（不然链接可能指向别人伪造的域名），只在服务器日志里提醒；回复照常
  const untrusted = !base && smtpConfigured();
  if (untrusted && !internal) {
    console.warn("[password-reset] 没有配置 APP_URL / OMS_URL，请求的域名也不在配置里，没有发送重置链接。请在 .env.local 里设置 APP_URL（客户 OMS 的网址）");
  }
  const r = internal || untrusted ? { emailed: smtpConfigured() } : await requestReset(email, base ?? "");
  const t = await getT();
  return {
    ok: r.emailed
      ? t("如果这个邮箱已开通账号，我们已发送重置密码的链接，请在 1 小时内查收邮件。")
      : `${t("已收到你的申请。客服会在工作时间内（一般 1 个工作日内）为你重置密码，并通过你登记的联系方式告知新密码。")}${
          getSettings().supportContact ? t("着急的话可以直接联系：{contact}", { contact: getSettings().supportContact }) : ""
        }`,
  };
}

/**
 * 重置密码链接用的网址：优先用配置的 APP_URL / OMS_URL。
 * 都没配置时，只有请求的域名是配置过的（ADMIN_URL、ALLOWED_ORIGINS 里写明的域名）才用；否则返回 null，不发链接。
 * Host 请求头谁都可以伪造：不能直接拿来拼链接，不然重置链接会发到攻击者的域名上。
 */
function resetLinkBase(h: { get(name: string): string | null }): string | null {
  const env = (process.env.APP_URL || process.env.OMS_URL || "").trim().replace(/\/+$/, "");
  if (env) return env;
  const host = (h.get("host") ?? "").trim().toLowerCase();
  if (!host) return null;
  const hostOf = (u: string) => {
    try {
      return new URL(u.includes("://") ? u : `https://${u}`).host.toLowerCase();
    } catch {
      return "";
    }
  };
  const admin = (process.env.ADMIN_URL ?? "").trim().replace(/\/+$/, "");
  if (admin && hostOf(admin) === host) return admin;
  // ALLOWED_ORIGINS 里写明的域名（带 * 的通配不算）
  const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((x) => x.trim()).filter((x) => x && !x.includes("*")).map(hostOf);
  if (!allowed.includes(host)) return null;
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https" ? "https" : "http";
  return `${proto}://${host}`;
}

export async function portalResetAction(_: unknown, fd: FormData) {
  const token = str(fd.get("token"), 100);
  const pw = String(fd.get("password") ?? "");
  if (pw !== String(fd.get("confirm") ?? "")) return { error: await tMsg("两次输入的密码不一致") };
  // 公司自用账户（成本价）不能登录客户 OMS：它的重置链接一律当作失效
  const owner = checkToken(token);
  if (owner && isInternalCustomer(owner)) return { error: await tMsg("链接已失效，请重新申请") };
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

/* ---------------- 电商店铺（Shopify / eBay） ---------------- */

const STORES_LOCKED = "店铺对接还没有为你的账户开放，请联系客服";

/** 店铺对接在测试阶段：后台给这个客户开放了才能用 */
async function storeCustomer() {
  const me = await requireCustomer();
  return storesEnabled(me.id) ? me : null;
}

/** 客户点“同步订单”：同步自己所有已连接的店铺 */
export async function syncMyStoresAction(_: FlashState): Promise<FlashState> {
  const me = await storeCustomer();
  if (!me) return { error: await tMsg(STORES_LOCKED) };
  const list = listStores(me.id).filter((s) => s.status === "connected");
  if (!list.length) return { error: await tMsg("还没有已连接的店铺") };
  let added = 0;
  const errs: string[] = [];
  for (const s of list) {
    try {
      added += (await syncStore(s.id)).added;
    } catch (e) {
      errs.push(`${s.name}：${(e as Error).message}`);
    }
  }
  revalidatePath("/portal/stores");
  if (errs.length) return { error: errs.join("；") };
  return { ok: (await getT())("同步完成，新增 {n} 个待发货订单", { n: added }) };
}

/** 勾选的店铺订单导入批量下单（默认包裹尺寸由客户选），返回批次 ID */
export async function importStoreOrdersAction(input: { senderId?: number | null; orders: { id: number; pkg: { length: number; width: number; height: number; weight: number; unit: number } }[] }): Promise<{ jobId?: number; error?: string }> {
  const me = await storeCustomer();
  if (!me) return { error: await tMsg(STORES_LOCKED) };
  try {
    const picks = (input.orders ?? []).slice(0, 500).map(({ id, pkg }) => {
      const u = Number(pkg?.unit);
      return { id: Number(id), pkg: { length: n(pkg?.length), width: n(pkg?.width), height: n(pkg?.height), weight: n(pkg?.weight), unit: (u === 1 || u === 2 ? u : 3) as 1 | 2 | 3 } };
    }).filter((p) => p.id > 0);
    const jobId = importToBatch(me.id, picks, await portalActor(), Number(input.senderId) || null);
    revalidatePath("/portal", "layout");
    return { jobId };
  } catch (e) {
    return { error: await tMsg((e as Error).message) };
  }
}

export async function disconnectMyStoreAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const me = await storeCustomer();
  if (!me) return { error: await tMsg(STORES_LOCKED) };
  try {
    disconnectStore(Number(fd.get("id")), me.id);
    revalidatePath("/portal/stores");
    return { ok: await tMsg("已断开连接，不会再同步这个店铺的订单") };
  } catch (e) {
    return { error: await tMsg((e as Error).message) };
  }
}

/**
 * 客户自己添加 / 修改 Shopify 店铺（店铺域名 + 自己建的 App 的 Client ID / Secret）。
 * 返回下一步要打开的网址：已连上（演示店铺）就回店铺订单页，否则去 Shopify 授权。
 */
export async function saveMyShopifyStoreAction(input: { id?: number | null; shop: string; clientId: string; clientSecret?: string }): Promise<{ next?: string; error?: string }> {
  const me = await storeCustomer();
  if (!me) return { error: await tMsg(STORES_LOCKED) };
  try {
    const id = saveShopifyStore({
      id: Number(input.id) || null,
      customerId: me.id,
      shop: String(input.shop ?? "").slice(0, 100),
      clientId: String(input.clientId ?? "").slice(0, 100),
      clientSecret: String(input.clientSecret ?? "").slice(0, 200) || undefined,
    });
    revalidatePath("/portal", "layout");
    if (getStore(id)?.status === "connected") {
      await syncStore(id).catch(() => null);
      return { next: "/portal/stores?connected=shopify" };
    }
    return { next: `/api/stores/shopify/connect?store=${id}` };
  } catch (e) {
    return { error: await tMsg((e as Error).message) };
  }
}

export async function deleteMyStoreAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const me = await storeCustomer();
  if (!me) return { error: await tMsg(STORES_LOCKED) };
  try {
    deleteMyStore(Number(fd.get("id")), me.id);
    revalidatePath("/portal", "layout");
    return { ok: await tMsg("已删除") };
  } catch (e) {
    return { error: await tMsg((e as Error).message) };
  }
}

/* ---------------- 开放 API ---------------- */

/** 生成 API 密钥：完整密钥只在这里返回一次 */
export async function createApiKeyAction(input: { name?: string; mode: string; ipAllow?: string }): Promise<{ token?: string; error?: string }> {
  const me = await requireCustomer();
  const { apiEnabled, createKey } = await import("@/lib/api/keys");
  if (!apiEnabled(me.id)) return { error: await tMsg("API 还没有为你的账户开通，请联系客服") };
  try {
    const { token } = createKey(me.id, { name: str(input.name, 40), mode: input.mode === "test" ? "test" : "live", ipAllow: str(input.ipAllow, 500) });
    revalidatePath("/portal/api");
    return { token };
  } catch (e) {
    return { error: await tMsg((e as Error).message) };
  }
}

export async function revokeApiKeyAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const me = await requireCustomer();
  const { revokeKey } = await import("@/lib/api/keys");
  try {
    revokeKey(Number(fd.get("id")), me.id);
    revalidatePath("/portal/api");
    return { ok: await tMsg("已作废：用这个密钥的请求会被拒绝") };
  } catch (e) {
    return { error: await tMsg((e as Error).message) };
  }
}
