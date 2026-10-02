"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkPassword, checkRateLimit, clearFailures, clientIp, createSession, destroySession, hashPassword, recordFailure, requireAdmin } from "@/lib/auth";
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import {
  buildPreview,
  customerAmountFor,
  importAdjustments,
  parseSheet,
  type Mapping,
  type ParsedSheet,
  type Preview,
  shipmentHasAdjustment,
} from "@/lib/adjustments";
import {
  deleteAdjustmentBatch,
  findShipmentByKey,
  getAdjustment,
  getPasswordHash,
  getSettings,
  linkAdjustment,
  listChannels,
  setCustomerChannels,
  customerChannels,
  portalEmailTaken,
  unlinkAdjustment,
  saveCustomer,
  saveSettings,
  setChannelStamp,
  setCustomerStampMode,
  setLabelNote,
  setCustomerPassword,
  setCustomerSender,
  updateCustomerPortal,
  updateChannel,
  setChannelDisplay,
  type Settings,
  getCustomer,
  getChannel,
  setChannelRebate,
  houseCustomerId,
  isInternalCustomer,
} from "@/lib/db";
import type { PartialRule } from "@/lib/pricing";
import { getDhlClient, getShipBestClient, shipbestMode } from "@/lib/shipbest/client";
import { dhlSettings, DHL_LABEL_TEMPLATES, isDhlCode, type DhlSettings } from "@/lib/shipbest/dhl";
import { deleteStore, disconnectStore, ebaySettings, getStore, saveShopifyStore, setStoresEnabled, syncStore } from "@/lib/stores";
import type { EbaySettings } from "@/lib/stores/ebay";
import { saveDimRule } from "@/lib/rates";
import { CARRIERS } from "@/lib/carriers";
import { clearChannelNameCache, sameNameChannels } from "@/lib/channelDisplay";
import { clearTestData, resetSandboxData } from "@/lib/cleanup";
import { customerChannelMarkupsFor, logMarkupChange, setCustomerChannelMarkups } from "@/lib/markup";
import { defaultLimits, saveLimits, type ChannelLimits } from "@/lib/channelLimits";
import { activePromotion, deletePromotion, getPromotion, savePromotion, validatePromotion } from "@/lib/promotions";
import { isProductionSite } from "@/lib/sites";
import { checkAddress, needsAck, type AddressCheck } from "@/lib/addressCheck";
import { updateLead } from "@/lib/leads";
import { getJiaguClient, jiaguConfig, JG_PREFIX, JG_SUFFIX, warehouseFor } from "@/lib/shipbest/jiagu";
import { createBackup, deleteBackup, restoreBackup } from "@/lib/backup";
import { getShipment, resetTestEnv, setStoredMode, setTestAccount } from "@/lib/db";
import { getTerms, saveTerms } from "@/lib/terms";
import { sendMail } from "@/lib/mailer";
import { checkConfirmPin, checkFinancePin, setFinancePin } from "@/lib/financePin";
import { actorOf } from "@/lib/actor";
import { staffLogin } from "@/lib/staffStore";
import { testAddressService } from "@/lib/addressCheck";
import { listSenders, saveSender } from "@/lib/senders";
import { clearCredentials, readablePassword, rememberCredentials } from "@/lib/credentials";
import { clearBlocks, importCoverage, lookupZip, parseCoverageWorkbook, removeCoverage, setPrefilter } from "@/lib/coverage";
import { addLedger, balanceOf, postAdjustment } from "@/lib/ledger";
import { getT } from "@/lib/prefs";
import { isUsZip } from "@/lib/geo";
import { saveChannelSample } from "@/lib/labels";
import { approveTopup, rejectTopup, saveQr, deleteQr } from "@/lib/topup";
import { usdCnyQuote } from "@/lib/fx";
import { adminResetFromRequest } from "@/lib/passwordReset";
import type { Address, ShipmentRequest } from "@/lib/shipbest/types";
import { cleanAddress, cleanRequest, n, optNum, str, unit } from "@/lib/sanitize";
import type { StampConfig, StampOverride, StampSettings } from "@/lib/stampConfig";
import {
  confirmCancelled,
  createLabel,
  resubmitShipment,
  PriceChangedError,
  quoteAll,
  quoteForProspect,
  withdrawCancel,
  refreshShipment,
  requestCancel,
  syncChannels,
  validateRequest,
  withQuoteSkus,
  type ChannelQuote,
} from "@/lib/service";

/* ---------------- 登录 ---------------- */

export async function loginAction(_: unknown, fd: FormData) {
  const key = "admin:" + (await clientIp());
  // 除了按 IP，还有一个全站的总次数限制：换 IP 也不能无限试密码
  const limited = checkRateLimit(key) ?? checkRateLimit("admin:*", 50);
  if (limited) return { error: limited };
  const username = String(fd.get("username") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  // 登录名留空（或填 admin）= 主管理员，用后台密码；否则是员工账号
  const staff = username && username !== "admin" ? staffLogin(username, password) : null;
  if (username && username !== "admin" ? !staff : !checkPassword(password)) {
    recordFailure(key);
    recordFailure("admin:*");
    return { error: username && username !== "admin" ? "登录名或密码错误" : "密码错误" };
  }
  clearFailures(key);
  await createSession(staff ?? undefined);
  redirect(staff ? "/customers" : "/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

/* ---------------- 报价 / 出单 ---------------- */

/** 后台运费试算（不出单）：选已有客户按他的渠道和加价；不选客户则按临时加价试算所有渠道 */
export async function quoteAction(
  customerId: number,
  raw: ShipmentRequest,
  markup?: PartialRule,
): Promise<{ errors?: string[]; quotes?: ChannelQuote[] }> {
  const who = await requireAdmin({ staff: true });
  // 运费试算只需要地址和包裹：不检查商品明细，缺的用样品补上（出单时仍然严格校验）
  const req = withQuoteSkus(cleanRequest(raw));
  const errors = validateRequest(req, { forQuote: true });
  if (errors.length) return { errors };
  const m: PartialRule = {
    percent: markup?.percent ?? null,
    fixed: markup?.fixed ?? null,
    minProfit: markup?.minProfit ?? null,
  };
  const neg = negativeRule(m);
  if (neg) return { errors: [neg] };
  try {
    const quotes = customerId ? await quoteAll(customerId, req) : await quoteForProspect(req, m);
    // 员工（二级管理员）只看客户价，不把成本、利润发到浏览器
    return { quotes: who.role === "staff" ? quotes.map((q) => ({ ...q, cost: undefined, listCost: undefined, profit: undefined }) as unknown as ChannelQuote) : quotes };
  } catch (e) {
    return { errors: [(e as Error).message] };
  }
}

/* ---------------- 管理员下单（公司自用账户，按成本价） ---------------- */

/** 管理员查运费：所有已启用渠道（同一物流商的多个渠道一起比），价格 = 成本 */
export async function houseQuoteAction(raw: ShipmentRequest): Promise<{ errors?: string[]; quotes?: ChannelQuote[]; address?: AddressCheck }> {
  await requireAdmin();
  const req = cleanRequest(raw);
  const errors = validateRequest(req);
  if (errors.length) return { errors };
  try {
    const [quotes, address] = await Promise.all([quoteAll(houseCustomerId(), req), checkAddress(req.recipient)]);
    return { quotes, address };
  } catch (e) {
    return { errors: [(e as Error).message] };
  }
}

/** 管理员出单：记在“公司自用（成本价）”账户下，不扣任何客户余额 */
export async function houseCreateAction(input: {
  channelCode: string;
  req: ShipmentRequest;
  expectedPrice: number;
  customerRef?: string;
  remark?: string;
  addressAck?: boolean;
}): Promise<{ id?: number; error?: string; quote?: ChannelQuote }> {
  await requireAdmin();
  try {
    const req = cleanRequest(input.req);
    const address = await checkAddress(req.recipient);
    if (needsAck(address) && !input.addressAck) return { error: "收件地址可能有问题，请检查地址，或勾选“我确认地址无误”后再下单" };
    const id = await createLabel({
      customerId: houseCustomerId(),
      channelCode: str(input.channelCode),
      req,
      expectedPrice: n(input.expectedPrice),
      customerRef: str(input.customerRef, 50) || undefined,
      remark: str(input.remark, 200) || undefined,
      createdBy: "admin",
      addressCheck: needsAck(address) ? ({ ...address, acknowledged: true } as AddressCheck) : address,
    });
    revalidatePath("/shipments");
    return { id };
  } catch (e) {
    if (e instanceof PriceChangedError) return { error: e.message, quote: e.quote };
    return { error: (e as Error).message };
  }
}

// 客户的单在客户 OMS 里出（后台可以“进入客户 OMS”代客户操作）；管理员自己的单用上面的“管理员下单”

/* ---------------- 异常单修改后重新下单 ---------------- */

/** 按原订单客户的价格和渠道比价（公司自用账户就是成本价） */
export async function resubmitQuoteAction(oldId: number, raw: ShipmentRequest): Promise<{ errors?: string[]; quotes?: ChannelQuote[]; address?: AddressCheck }> {
  await requireAdmin();
  const old = getShipment(Number(oldId));
  if (!old || (old.status !== "exception" && old.status !== "cancelled") || old.replacedBy) return { errors: ["只有出单异常或已取消、还没重新下过单的订单可以重新下单"] };
  const req = cleanRequest(raw);
  const errors = validateRequest(req);
  if (errors.length) return { errors };
  try {
    const [quotes, address] = await Promise.all([quoteAll(old.customerId, req), checkAddress(req.recipient)]);
    return { quotes, address };
  } catch (e) {
    return { errors: [(e as Error).message] };
  }
}

export async function resubmitCreateAction(input: {
  oldId: number;
  channelCode: string;
  req: ShipmentRequest;
  expectedPrice: number;
  customerRef?: string;
  remark?: string;
  addressAck?: boolean;
}): Promise<{ id?: number; error?: string; quote?: ChannelQuote }> {
  await requireAdmin();
  try {
    const req = cleanRequest(input.req);
    const address = await checkAddress(req.recipient);
    if (needsAck(address) && !input.addressAck) return { error: "收件地址可能有问题，请检查地址，或勾选“我确认地址无误”后再下单" };
    const r = await resubmitShipment({
      oldId: Number(input.oldId),
      channelCode: str(input.channelCode),
      req,
      expectedPrice: n(input.expectedPrice),
      customerRef: str(input.customerRef, 50) || undefined,
      remark: str(input.remark, 200) || undefined,
      addressCheck: needsAck(address) ? ({ ...address, acknowledged: true } as AddressCheck) : address,
    });
    revalidatePath("/shipments");
    revalidatePath(`/shipments/${input.oldId}`);
    return { id: r.id };
  } catch (e) {
    if (e instanceof PriceChangedError) return { error: e.message, quote: e.quote };
    return { error: (e as Error).message };
  }
}

/* ---------------- 订单操作 ---------------- */

export type FlashState = { ok?: string; error?: string } | null;

export async function refreshAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id"));
  try {
    const s = await refreshShipment(id);
    revalidatePath(`/shipments/${id}`);
    return { ok: `已刷新：${s.status === "labeled" ? "面单已生成" : "状态已更新"}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function cancelAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id"));
  try {
    const r = await requestCancel(id);
    revalidatePath(`/shipments/${id}`);
    return r.done ? { ok: r.message } : { error: r.message };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function withdrawCancelAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id"));
  try {
    withdrawCancel(id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/shipments/${id}`);
  return { ok: "已撤回取消申请，面单恢复可用" };
}

export async function confirmCancelAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id"));
  try {
    confirmCancelled(id, n(fd.get("cancelFee")), n(fd.get("sbCancelFee")));
    revalidatePath(`/shipments/${id}`);
    return { ok: "已确认取消" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ---------------- 客户 ---------------- */

function ruleFromForm(fd: FormData, prefix = ""): PartialRule {
  return {
    percent: optNum(fd.get(prefix + "percent")),
    fixed: optNum(fd.get(prefix + "fixed")),
    minProfit: optNum(fd.get(prefix + "minProfit")),
  };
}

/** 这个渠道能填的负数加价下限来自哪个返利：渠道长期返利、进行中的限时活动返利，取大的 */
function allowedRebate(code: string, channelRebate?: number): number {
  return Math.max(channelRebate ?? getChannel(code)?.rebate ?? 0, activePromotion(code)?.rebatePercent ?? 0);
}

/**
 * 加价不允许低于成本：固定加价、最低利润不能为负数；
 * 加价 % 只有渠道有服务商返利时才能填负数，最低到 -返利%（再低就亏本）。
 */
function negativeRule(r: PartialRule, who = "", rebate = 0): string | null {
  if ([r.fixed, r.minProfit].some((v) => v !== null && v !== undefined && v < 0)) return `${who}固定加价、最低利润不能为负数（会低于成本出单）`;
  const p = r.percent;
  if (p === null || p === undefined || p >= 0) return null;
  if (!(rebate > 0)) return `${who}加价不能为负数（会低于成本出单）。如果服务商对这个渠道有返利，先在“设置 → 物流渠道”填上服务商返利 %，就可以填负数`;
  if (p < -rebate) return `${who}加价最低只能到 -${rebate}%（这个渠道服务商返利 ${rebate}%，再低就亏本）`;
  return null;
}

export async function setTestAccountAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id"));
  const c = getCustomer(id);
  if (!c || c.internal) return { error: "客户不存在" };
  const on = fd.get("on") === "1";
  setTestAccount(id, on);
  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
  return { ok: on ? "已设为内部测试账号：之后这个账号下的单都是模拟面单，不产生费用" : "已取消内部测试账号：之后这个账号下单会真实出单扣费" };
}

export async function saveCustomerAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin({ staff: true });
  const name = str(fd.get("name"));
  if (!name) return { error: "客户名称必填" };
  const idRaw = Number(fd.get("id"));
  const isNew = !(idRaw > 0);
  const email = str(fd.get("email"), 100).toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "邮箱格式不正确" };
  // 新客户：邮箱就是 OMS 登录账号，保存时直接开通登录并生成初始密码
  if (isNew && email && portalEmailTaken(email)) return { error: "这个邮箱已经被其他客户用作登录账号" };
  // 联系人、职位、电话、地址会写进客户签署的服务条款，必须填写
  for (const [k, label] of [["contact", "联系人"], ["contactTitle", "联系人职位"], ["phone", "电话"], ["address", "地址"]] as const) {
    if (!str(fd.get(k), 200)) return { error: `请填写${label}` };
  }
  const neg = negativeRule(ruleFromForm(fd));
  if (neg) return { error: neg };
  const beforeMarkup = isNew ? null : getCustomer(idRaw)?.markup ?? null;
  const savedId = saveCustomer(isNew ? null : idRaw, {
    name,
    contact: str(fd.get("contact")) || null,
    contactTitle: str(fd.get("contactTitle"), 60) || null,
    address: str(fd.get("address"), 200) || null,
    phone: str(fd.get("phone")) || null,
    email,
    note: str(fd.get("note"), 1000) || null,
    markup: ruleFromForm(fd),
  });
  logMarkupChange({ scope: "customer", customerId: savedId, label: name, before: beforeMarkup, after: ruleFromForm(fd) });
  revalidatePath("/customers");
  if (isNew) {
    if (email) {
      updateCustomerPortal(savedId, { email, enabled: true, creditLimit: 0 });
      const pw = readablePassword();
      setCustomerPassword(savedId, hashPassword(pw));
      rememberCredentials(savedId, email, pw);
    }
    // 新客户保存后进入详情页：显示开户信息，继续开通渠道、充值
    redirect(`/customers/${savedId}`);
  }
  return { ok: "已保存" };
}

export async function hideCredentialsAction(id: number) {
  await requireAdmin({ staff: true });
  clearCredentials(id);
  revalidatePath(`/customers/${id}`);
}

export async function saveCustomerPortalAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const who = await requireAdmin({ staff: true });
  const id = Number(fd.get("id"));
  const email = str(fd.get("portalEmail"), 100).toLowerCase() || null;
  const enabled = fd.get("portalEnabled") === "on";
  if (enabled && !email) return { error: "开通登录需要填写登录邮箱" };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "登录邮箱格式不正确" };
  try {
    // 信用额度（允许欠款多少）只有主管理员能改；员工保存时保留原来的
    const creditLimit = who.role === "staff" ? getCustomer(id)?.creditLimit ?? 0 : Math.max(0, optNum(fd.get("creditLimit")) ?? 0);
    updateCustomerPortal(id, { email, enabled, creditLimit });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/customers/${id}`);
  return { ok: enabled && !getPasswordHash(id) ? "已保存。还没有设置密码，请在下方设置登录密码。" : "已保存" };
}

export async function setCustomerPasswordAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin({ staff: true });
  const id = Number(fd.get("id"));
  const c = getCustomer(id);
  if (!c) return { error: "客户不存在" };
  // 还没填登录邮箱时用客户资料里的邮箱；生成密码时顺便开通登录
  const email = c.portalEmail ?? c.email?.toLowerCase() ?? null;
  if (!email) return { error: "请先在上面填写登录邮箱" };
  let pw = String(fd.get("password") ?? "").trim();
  const generated = !pw;
  if (generated) pw = readablePassword();
  if (pw.length < 8 && !generated) return { error: "密码至少 8 位（留空则自动生成）" };
  if (!c.portalEnabled || !c.portalEmail) {
    try {
      updateCustomerPortal(id, { email, enabled: true, creditLimit: c.creditLimit });
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
  setCustomerPassword(id, hashPassword(pw));
  rememberCredentials(id, email, pw);
  revalidatePath(`/customers/${id}`);
  return { ok: "密码已更新，页面上方的“开户信息”可以直接复制发给客户。客户原来的登录会失效。" };
}

export async function saveCustomerSenderAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin({ staff: true });
  const id = Number(fd.get("id"));
  const sender = cleanAddress(Object.fromEntries([...fd.entries()].filter(([k]) => k.startsWith("sender.")).map(([k, v]) => [k.slice(7), v])) as Partial<Address>);
  // 国家下拉框默认就有值，不算“填了”；其余全部留空 = 清除，改用系统默认寄件地址
  const filled = (Object.keys(sender) as (keyof Address)[]).some((k) => k !== "country" && !!sender[k]);
  if (filled) {
    // 和客户端保存寄件地址一样检查必填项，避免存下不完整、出不了面单的地址
    const t = await getT();
    const us = !sender.country || sender.country === "US";
    const errs: string[] = [];
    if (!sender.nameFirst) errs.push("姓名");
    if (!sender.address1) errs.push("地址1");
    if (!sender.city) errs.push("城市");
    if (us && !sender.province) errs.push("州/省");
    if (!sender.zipCode) errs.push("邮编");
    if (errs.length) return { error: t("请填写：{fields}", { fields: errs.map((x) => t(x)).join(t("、")) }) };
    if (us && !isUsZip(sender.zipCode)) return { error: t("美国邮编是 5 位数字（可以带 4 位，例如 78701-1234）") };
    // 更新客户地址簿里的默认地址（没有就新建一个默认地址）
    const def = listSenders(id).find((x) => x.isDefault);
    saveSender(id, { id: def?.id, label: def?.label, address: sender, makeDefault: true });
  } else {
    setCustomerSender(id, null);
  }
  revalidatePath(`/customers/${id}`);
  return { ok: "默认寄件地址已保存" };
}

export async function ledgerEntryAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const who = await requireAdmin({ staff: true });
  const pinErr = checkConfirmPin(who, str(fd.get("financePin"), 10));
  if (pinErr) return { error: pinErr };
  const id = Number(fd.get("id"));
  // 类型：充值 / 加款 / 扣款（金额都填正数，扣款时系统转成负数，不会因为漏打负号扣成加）；兼容旧的 manual（正负号）
  const kind = String(fd.get("type") ?? "");
  if (!["topup", "manual_add", "manual_sub", "manual"].includes(kind)) return { error: "请选择类型" };
  // 员工只能记“充值”；加款、扣款只有主管理员能做
  if (who.role === "staff" && kind !== "topup") return { error: "员工账号只能记充值，加款 / 扣款请找主管理员" };
  const type = kind === "topup" ? "topup" : "manual";
  const raw = optNum(fd.get("amount"));
  if (!raw) return { error: fd.get("amount") ? "金额不能为 0" : "请填写金额" };
  if (kind !== "manual" && raw < 0) return { error: "金额请填正数；要扣款请选“扣款”" };
  const amount = kind === "manual_sub" ? -Math.abs(raw) : raw;
  const note = str(fd.get("note"), 200) || null;
  if (type === "manual" && !note) return { error: "手动调账请填写说明" };
  addLedger({ customerId: id, type, amount, note, createdBy: actorOf(who) });
  revalidatePath(`/customers/${id}`);
  return { ok: `已${type === "topup" ? "充值" : "调账"} ${amount.toFixed(2)}，当前余额 ${balanceOf(id).toFixed(2)}` };
}

/* ---------------- 设置 ---------------- */

export async function saveSettingsAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const cur = getSettings();
  const negG = negativeRule({ percent: optNum(fd.get("percent")), fixed: optNum(fd.get("fixed")), minProfit: optNum(fd.get("minProfit")) }, "全局");
  if (negG) return { error: negG };
  const patch: Partial<Settings> = {
    markup: {
      percent: optNum(fd.get("percent")) ?? 0,
      fixed: optNum(fd.get("fixed")) ?? 0,
      minProfit: optNum(fd.get("minProfit")) ?? 0,
    },
    roundingStep: optNum(fd.get("roundingStep")) ?? cur.roundingStep,
    cancelFeePercent: optNum(fd.get("cancelFeePercent")) ?? cur.cancelFeePercent,
    cancelWindowHours: Math.max(0, Math.round(optNum(fd.get("cancelWindowHours")) ?? cur.cancelWindowHours ?? 48)),
    sbCancelFeePercent: optNum(fd.get("sbCancelFeePercent")) ?? cur.sbCancelFeePercent,
    defaultUnit: unit(fd.get("defaultUnit")),
    defaultCurrency: str(fd.get("defaultCurrency"), 3).toUpperCase() || "USD",
    adjustmentPolicy: (["at_cost", "with_markup", "none"] as const).find((p) => p === fd.get("adjustmentPolicy")) ?? cur.adjustmentPolicy,
    brandName: str(fd.get("brandName"), 60) || cur.brandName,
    balanceRule: fd.get("balanceRule") === "cover" ? "cover" : "positive",
    supportContact: str(fd.get("supportContact"), 200),
  };
  const sender = cleanAddress(Object.fromEntries([...fd.entries()].filter(([k]) => k.startsWith("sender.")).map(([k, v]) => [k.slice(7), v])) as Partial<Address>);
  // 设置页已不再编辑发货仓地址：表单里没有这些字段时保留原值
  if ([...fd.keys()].some((k) => k.startsWith("sender."))) patch.sender = sender.nameFirst || sender.address1 ? sender : null;
  logMarkupChange({ scope: "global", label: "全局默认", before: cur.markup, after: patch.markup });
  saveSettings(patch);
  revalidatePath("/settings");
  return { ok: "设置已保存" };
}

export async function saveChannelsAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const rebateOf = (c: { code: string; rebate: number }) => (fd.has(`rebate.${c.code}`) ? Math.min(99, Math.max(0, optNum(fd.get(`rebate.${c.code}`)) ?? 0)) : c.rebate);
  for (const c of listChannels()) {
    const neg = negativeRule(ruleFromForm(fd, `${c.code}.`), `${c.name}：`, allowedRebate(c.code, rebateOf(c)));
    if (neg) return { error: neg };
  }
  // 返利调低后，已经填的负数加价（渠道或客户按渠道）不能低于新的返利
  for (const c of listChannels()) {
    const r = rebateOf(c);
    if (r >= c.rebate) continue;
    const low = customerChannelMarkupsFor(c.code).find((x) => x.percent !== null && x.percent < -r);
    if (low) return { error: `${c.name}：客户“${low.customerName}”在这个渠道的加价是 ${low.percent}%，低于新的返利 ${r}%，请先改客户的按渠道加价` };
  }
  for (const c of listChannels()) {
    const r = rebateOf(c);
    if (r !== c.rebate) {
      logMarkupChange({ scope: "channel", channelCode: c.code, label: `${c.name} 服务商返利 ${c.rebate}% → ${r}%`, before: null, after: null, force: true });
      setChannelRebate(c.code, r);
    }
    logMarkupChange({ scope: "channel", channelCode: c.code, label: c.name, before: c.markup, after: ruleFromForm(fd, `${c.code}.`) });
    updateChannel(c.code, fd.get(`enabled.${c.code}`) === "on", ruleFromForm(fd, `${c.code}.`));
    // 客户看到的名称 / 物流商（空 = 自动）
    if (fd.has(`display.${c.code}`)) {
      const carrier = str(fd.get(`carrier.${c.code}`), 20);
      setChannelDisplay(c.code, str(fd.get(`display.${c.code}`), 40) || null, CARRIERS.some((x) => x.id === carrier) ? carrier : null);
    }
  }
  clearChannelNameCache();
  revalidatePath("/", "layout");
  return { ok: "渠道设置已保存" };
}

export async function syncChannelsAction(_: FlashState): Promise<FlashState> {
  await requireAdmin();
  try {
    const count = await syncChannels();
    revalidatePath("/settings");
    return { ok: `已同步 ${count} 个渠道` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function saveAddrCheckAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const st = getSettings();
  const cur = st.addrCheck ?? { enabled: true, provider: "google", googleKey: "", monthlyCap: 5000 };
  const us = st.usps ?? { enabled: true, consumerKey: "", consumerSecret: "" };
  const provider = fd.get("provider") === "usps" ? "usps" : "google";
  const cap = Math.max(0, Math.floor(Number(fd.get("monthlyCap")) || 0));
  const enabled = fd.get("enabled") === "on";
  saveSettings({
    addrCheck: { enabled, provider, googleKey: str(fd.get("googleKey"), 200) || cur.googleKey, monthlyCap: cap }, // 密钥留空 = 不修改
    usps: { ...us, consumerKey: str(fd.get("consumerKey"), 200) || us.consumerKey, consumerSecret: str(fd.get("consumerSecret"), 200) || us.consumerSecret },
  });
  revalidatePath("/settings");
  if (!enabled) return { ok: "已保存（地址核对已停用）" };
  try {
    return { ok: await testAddressService() };
  } catch (e) {
    return { error: `已保存，但连接测试失败：${(e as Error).message}` };
  }
}

export async function testAddrAction(_: FlashState): Promise<FlashState> {
  await requireAdmin();
  try {
    return { ok: await testAddressService() };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** 服务条款：保存中英文内容；勾选“要求重新同意”时版本号 +1，所有客户下次登录都要重新签署 */
export async function saveTermsAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const zh = String(fd.get("zh") ?? "").slice(0, 30000);
  const en = String(fd.get("en") ?? "").slice(0, 30000);
  if (!zh.trim()) return { error: "中文条款不能为空" };
  const bump = fd.get("bump") === "on";
  saveTerms(zh, en, bump, String(fd.get("changeNote") ?? ""));
  revalidatePath("/settings");
  return { ok: bump ? `已保存为第 ${getTerms().version} 版，所有客户下次登录时需要重新签署` : "服务条款已保存" };
}

export async function resetTermsAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const bump = fd.get("bump") === "on";
  saveTerms("", "", bump, String(fd.get("changeNote") ?? ""));
  revalidatePath("/settings");
  return { ok: bump ? `已恢复为系统默认条款（第 ${getTerms().version} 版），所有客户下次登录时需要重新签署` : "已恢复为系统默认条款" };
}

export async function setFinancePinAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  // 设置 / 修改都要管理员登录密码
  if (!checkPassword(String(fd.get("adminPassword") ?? ""))) return { error: "管理员登录密码不正确" };
  const pin = str(fd.get("pin"), 10);
  if (pin !== str(fd.get("pin2"), 10)) return { error: "两次输入的财务确认密码不一致" };
  try {
    setFinancePin(pin);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/settings");
  return { ok: "财务确认密码已设置" };
}

export async function saveSmtpAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const cur = getSettings().smtp ?? { host: "", port: 465, user: "", pass: "", from: "" };
  saveSettings({
    notifyEnabled: fd.get("notifyEnabled") === "on",
    smtp: {
      host: str(fd.get("host"), 120),
      port: Math.max(1, Number(fd.get("port")) || 465),
      user: str(fd.get("user"), 120),
      pass: str(fd.get("pass"), 200) || cur.pass, // 留空 = 不修改
      from: str(fd.get("from"), 160),
    },
  });
  revalidatePath("/settings");
  return { ok: "邮件设置已保存" };
}

export async function testMailAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const to = str(fd.get("to"), 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { error: "请填写收件邮箱" };
  try {
    await sendMail(to, `${getSettings().brandName} · 测试邮件 / Test email`, "这是一封测试邮件，说明发件邮箱设置正确。\nThis is a test email — your mail settings work.");
    return { ok: `已发送到 ${to}，请查收（也看看垃圾邮件箱）` };
  } catch (e) {
    return { error: `发送失败：${(e as Error).message}` };
  }
}

export async function resetTestEnvAction(_: FlashState, fd?: FormData): Promise<FlashState> {
  await requireAdmin();
  if (isProductionSite()) return { error: "正式站没有测试环境，测试请到沙盒站" };
  if (String(fd?.get("confirmText") ?? "").trim() !== "重置测试环境") return { error: "请输入“重置测试环境”确认" };
  resetTestEnv();
  clearChannelNameCache();
  revalidatePath("/", "layout");
  return { ok: "测试环境已重置：客户、渠道、设置已从正式数据重新复制，测试订单、充值和余额已清空" };
}

export async function createBackupAction(_: FlashState): Promise<FlashState> {
  await requireAdmin();
  try {
    const name = createBackup("manual");
    revalidatePath("/backups");
    return { ok: `已备份：${name}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function restoreBackupAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  if (!checkPassword(String(fd.get("adminPassword") ?? ""))) return { error: "管理员登录密码不正确" };
  const name = str(fd.get("name"), 200);
  try {
    const { safety } = restoreBackup(name);
    clearChannelNameCache();
    revalidatePath("/", "layout");
    return { ok: `已恢复到 ${name}。恢复前的数据已另存为 ${safety}，需要时可以再恢复回来。` };
  } catch (e) {
    return { error: `恢复失败：${(e as Error).message}` };
  }
}

export async function deleteBackupAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  try {
    deleteBackup(str(fd.get("name"), 200));
    revalidatePath("/backups");
    return { ok: "已删除" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function clearTestDataAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const typed = str(fd.get("confirm"), 50);
  if (typed !== "清除测试数据" && typed.toUpperCase() !== "CLEAR") return { error: "请在输入框里输入“清除测试数据”确认" };
  try {
    const { backup, removed } = clearTestData();
    revalidatePath("/", "layout");
    return { ok: `已清除 ${removed.testShipments} 张模拟 / 沙盒订单及相关扣款记录，真实订单没有变动。清除前的数据已备份为 ${backup}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function verifyAction(_: FlashState): Promise<FlashState> {
  await requireAdmin();
  try {
    await getShipBestClient().verify();
    return { ok: "连接成功，授权信息有效" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ---------------- 官方账单补差 ---------------- */

export async function parseAdjustmentFileAction(fd: FormData): Promise<{ error?: string; sheet?: ParsedSheet }> {
  await requireAdmin();
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { error: "请选择文件" };
  if (file.size > 10 * 1024 * 1024) return { error: "文件不能超过 10MB" };
  try {
    return { sheet: await parseSheet(file.name, Buffer.from(await file.arrayBuffer())) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function cleanMapping(m: Mapping): Mapping {
  return {
    headerRow: Math.max(0, Math.floor(n(m.headerRow))),
    keyCol: Math.floor(n(m.keyCol)),
    altKeyCol: Number.isInteger(m.altKeyCol) && m.altKeyCol !== m.keyCol ? m.altKeyCol : -1,
    amountCol: Math.floor(n(m.amountCol)),
    reasonCol: Number.isInteger(m.reasonCol) ? m.reasonCol : -1,
    positiveMeans: m.positiveMeans === "refund" ? "refund" : "charge",
  };
}

function cleanRows(rows: unknown): string[][] {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 20000).map((r) => (Array.isArray(r) ? r.slice(0, 100).map((c) => str(c, 500)) : []));
}

export async function previewAdjustmentAction(rows: string[][], mapping: Mapping): Promise<{ error?: string; preview?: Preview }> {
  await requireAdmin();
  const m = cleanMapping(mapping);
  if (m.keyCol < 0 || m.amountCol < 0) return { error: "请选择单号列和金额列" };
  return { preview: buildPreview(cleanRows(rows), m) };
}

export async function importAdjustmentAction(input: {
  filename: string;
  rows: string[][];
  mapping: Mapping;
  note?: string;
}): Promise<{ error?: string; batchId?: number }> {
  await requireAdmin();
  try {
    const m = cleanMapping(input.mapping);
    if (m.keyCol < 0 || m.amountCol < 0) return { error: "请选择单号列和金额列" };
    const batchId = importAdjustments(str(input.filename), cleanRows(input.rows), m, str(input.note, 500) || null);
    revalidatePath("/adjustments");
    return { batchId };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteBatchAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  deleteAdjustmentBatch(Number(fd.get("id")));
  revalidatePath("/adjustments");
  redirect("/adjustments");
}

export async function linkAdjustmentAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const adj = getAdjustment(Number(fd.get("id")));
  if (!adj) return { error: "记录不存在" };
  if (adj.shipment_id) return { error: "已经关联过了" };
  const s = findShipmentByKey(str(fd.get("key")));
  if (!s) return { error: "找不到这个单号对应的面单" };
  if (shipmentHasAdjustment(s.id)) return { error: "这一单已经有补差记录了，不能重复关联（避免重复扣款）" };
  // 关联到异常状态的面单时先提醒，勾选“仍然关联”后再提交
  if (fd.get("force") !== "1") {
    const warn: string[] = [];
    if (s.status === "cancelled") warn.push("这张面单已经取消");
    if (s.status === "exception") warn.push("这张面单是异常状态");
    if (adj.reason && s.channelName && !sameCarrier(adj.reason, s.channelName)) warn.push(`补差原因里的渠道和面单渠道（${s.channelName}）可能不一致`);
    if (warn.length) return { error: `${warn.join("；")}。确认没关联错的话，勾选“仍然关联”再提交。` };
  }
  const amount = isInternalCustomer(s.customerId) ? 0 : customerAmountFor(adj.cost_amount, adj.policy, s.rule);
  linkAdjustment(adj.id, s.id, s.customerId, amount);
  postAdjustment(adj.id, s.customerId, s.id, amount, adj.reason || `账单补差 · ${s.trackingNo ?? s.customNo}`);
  revalidatePath(`/adjustments/${adj.batch_id}`);
  return { ok: `已关联到 ${s.customNo}（${s.customerName}），向客户${amount >= 0 ? "补收" : "退回"} ${Math.abs(amount).toFixed(2)}` };
}

/** 补差原因里提到了某个承运商、而面单是另一个承运商时提醒 */
function sameCarrier(reason: string, channel: string) {
  const carriers = ["GOFO", "USPS", "UNIUNI", "UNI", "SWIFTX", "YWE", "SPX", "SPEEDX", "FEDEX", "UPS"];
  const r = reason.toUpperCase();
  const c = channel.toUpperCase();
  const mentioned = carriers.filter((k) => r.includes(k));
  return !mentioned.length || mentioned.some((k) => c.includes(k));
}

export async function unlinkAdjustmentAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const adj = getAdjustment(Number(fd.get("id")));
  if (!adj) return { error: "记录不存在" };
  if (!adj.shipment_id) return { error: "这条还没有关联" };
  unlinkAdjustment(adj.id);
  revalidatePath(`/adjustments/${adj.batch_id}`);
  return { ok: "已取消关联，客户钱包里的这笔补差已撤回" };
}

/* ---------------- 面单加印 SKU ---------------- */

function cleanStamp(o: Partial<StampConfig>): Partial<StampConfig> {
  const out: Partial<StampConfig> = {};
  const numIn = (v: unknown, min: number, max: number) => {
    const x = Number(v);
    return v === undefined || v === null || v === "" || !Number.isFinite(x) ? undefined : Math.min(max, Math.max(min, x));
  };
  const x = numIn(o.x, 0, 3.9), y = numIn(o.y, 0, 5.9), fs = numIn(o.fontSize, 5, 24), mw = numIn(o.maxWidth, 0.5, 4), ml = numIn(o.maxLines, 1, 5);
  if (x !== undefined) out.x = x;
  if (y !== undefined) out.y = y;
  if (fs !== undefined) out.fontSize = fs;
  if (mw !== undefined) out.maxWidth = mw;
  if (ml !== undefined) out.maxLines = Math.round(ml);
  if (o.rotate !== undefined && [0, 90, 180, 270].includes(Number(o.rotate))) out.rotate = Number(o.rotate) as StampConfig["rotate"];
  return out;
}

export async function saveStampAction(g: StampSettings): Promise<FlashState> {
  await requireAdmin();
  const cur = getSettings().stamp;
  saveSettings({
    stamp: {
      ...cur,
      ...cleanStamp(g),
      enabled: !!g.enabled,
      autoDetect: g.autoDetect !== false,
      whiteBg: !!g.whiteBg,
      bold: !!g.bold,
      showQty: !!g.showQty,
      // 前缀末尾的空格要保留（“SKU: ”）
      prefix: String(g.prefix ?? "").slice(0, 30),
      separator: String(g.separator ?? " / ").slice(0, 10),
    },
  });
  revalidatePath("/settings");
  return { ok: "加印设置已保存" };
}

export async function saveChannelStampAction(code: string, o: StampOverride): Promise<FlashState> {
  await requireAdmin();
  const c = cleanStamp(o) as StampOverride;
  if (o.enabled === true || o.enabled === false) c.enabled = o.enabled;
  setChannelStamp(str(code, 50), c);
  revalidatePath("/settings");
  return { ok: "该渠道的加印位置已保存" };
}

export async function saveCustomerStampAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id"));
  const m = fd.get("stampMode");
  setCustomerStampMode(id, m === "on" || m === "off" ? m : "inherit");
  revalidatePath(`/customers/${id}`);
  return { ok: "已保存" };
}

export async function saveCustomerChannelsAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin({ staff: true });
  const id = Number(fd.get("id"));
  if (!getCustomer(id)) return { error: "客户不存在" };
  const codes = fd.getAll("channels").map((v) => str(v, 50)).filter(Boolean);
  // 同一个客户不能开通两个客户看起来一样的渠道（例如两家服务商的 USPS）：客户分不清，只能选一个
  const clash = sameNameChannels(codes);
  if (clash) return { error: `“${clash.publicName}”开通了 ${clash.names.length} 个（${clash.names.join("、")}），客户看到的名称一样，只能选一个` };
  setCustomerChannels(id, codes);
  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
  return { ok: codes.length ? `已保存，开通 ${codes.length} 个渠道` : "已保存：这个客户现在没有可用渠道，无法下单" };
}

export async function saveCustomerChannelMarkupAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin({ staff: true });
  const id = Number(fd.get("id"));
  if (!getCustomer(id)) return { error: "客户不存在" };
  const rules: Record<string, PartialRule> = {};
  for (const c of customerChannels(id)) {
    const r = ruleFromForm(fd, `${c.code}.`);
    const neg = negativeRule(r, `${c.name}：`, allowedRebate(c.code));
    if (neg) return { error: neg };
    rules[c.code] = r;
  }
  setCustomerChannelMarkups(id, rules);
  revalidatePath(`/customers/${id}`);
  return { ok: "按渠道加价已保存，之后的报价和下单按新的比例计算" };
}

export async function saveLabelNoteAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id"));
  setLabelNote(id, str(fd.get("labelNote"), 200) || null);
  revalidatePath(`/shipments/${id}`);
  return { ok: "已保存，重新打开面单即可看到" };
}

/** 上传某个渠道的示例面单，用来在设置页预览、调整加印位置 */
export async function uploadChannelSampleAction(fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const code = str(fd.get("channel"), 50);
  const file = fd.get("file");
  if (!code) return { error: "请先选择渠道" };
  if (!(file instanceof File) || !file.size) return { error: "请选择面单文件" };
  if (file.size > 5 * 1024 * 1024) return { error: "文件不能超过 5MB" };
  try {
    saveChannelSample(code, Buffer.from(await file.arrayBuffer()));
    return { ok: "示例面单已上传，预览已更新" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ---------------- 充值审核 / 收款设置 ---------------- */

export async function approveTopupAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const who = await requireAdmin({ staff: true });
  const pinErr = checkConfirmPin(who, str(fd.get("financePin"), 10));
  if (pinErr) return { error: pinErr };
  let id = 0;
  try {
    id = Number(fd.get("id"));
    approveTopup(id, n(fd.get("creditedUsd")), str(fd.get("adminNote"), 200) || null, actorOf(who));
    revalidatePath("/finance");
  } catch (e) {
    return { error: (e as Error).message };
  }
  // 处理完这一行会从“待确认”里消失，FlashForm 的提示也跟着没了：跳回财务页，由页面顶部显示结果
  redirect(`/finance?done=approved&id=${id}#topups`);
}

export async function rejectTopupAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const who = await requireAdmin({ staff: true });
  let id = 0;
  try {
    id = Number(fd.get("id"));
    rejectTopup(id, str(fd.get("adminNote"), 200), actorOf(who));
    revalidatePath("/finance");
  } catch (e) {
    return { error: (e as Error).message };
  }
  redirect(`/finance?done=rejected&id=${id}#topups`);
}

export async function savePaymentSettingsAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const cur = getSettings();
  const markup = optNum(fd.get("fxMarkup"));
  const manual = optNum(fd.get("fxManualRate"));
  if (markup !== null && (markup < 0 || markup > 1)) return { error: "汇率加点请填 0 到 1 之间，例如 0.03" };
  if (manual !== null && (manual < 1 || manual > 20)) return { error: "备用汇率看起来不对（例如 7.2）" };
  saveSettings({
    zelleInfo: String(fd.get("zelleInfo") ?? "").slice(0, 500),
    alipayInfo: String(fd.get("alipayInfo") ?? "").slice(0, 500),
    topupInstructions: String(fd.get("topupInstructions") ?? "").slice(0, 2000),
    fxMode: fd.get("fxMode") === "manual" ? "manual" : "auto",
    fxRefresh: fd.get("fxRefresh") === "hourly" ? "hourly" : "daily",
    fxMarkup: markup ?? cur.fxMarkup,
    fxManualRate: manual ?? cur.fxManualRate,
  });
  for (const kind of ["alipay", "zelle"] as const) {
    if (fd.get(`${kind}QrRemove`) === "on") {
      deleteQr(kind);
      saveSettings(kind === "alipay" ? { alipayQr: false } : { zelleQr: false });
    }
    const file = fd.get(`${kind}Qr`);
    if (file instanceof File && file.size) {
      if (file.size > 3 * 1024 * 1024) return { error: "收款码图片不能超过 3MB" };
      try {
        saveQr(kind, Buffer.from(await file.arrayBuffer()));
        saveSettings(kind === "alipay" ? { alipayQr: true } : { zelleQr: true });
      } catch (e) {
        return { error: (e as Error).message };
      }
    }
  }
  revalidatePath("/settings");
  return { ok: "收款设置已保存" };
}

export async function refreshFxAction(_: FlashState): Promise<FlashState> {
  await requireAdmin();
  const q = await usdCnyQuote(true);
  revalidatePath("/settings");
  return q.manual && getSettings().fxMode === "auto"
    ? { error: `实时汇率获取失败，当前使用 ${q.source}：${q.live}` }
    : { ok: `实时汇率 ${q.live}（${q.source}），加点 ${q.markup} → 充值汇率 ${q.rate}` };
}

export async function handleResetRequestAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin({ staff: true });
  try {
    const r = adminResetFromRequest(Number(fd.get("id")));
    revalidatePath("/customers");
    return { ok: `${r.customerName} 的新密码：${r.password}　请发给客户（只显示这一次）` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ---------------- 派送范围（邮编覆盖表） ---------------- */

export async function parseCoverageAction(fd: FormData) {
  await requireAdmin();
  try {
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) return { error: "请选择文件" };
    if (file.size > 12 * 1024 * 1024) return { error: "文件不能超过 12MB" };
    const gateway = str(fd.get("gateway"), 10).toUpperCase() || "LAX";
    if (gateway !== getSettings().originGateway) saveSettings({ originGateway: gateway });
    return { preview: await parseCoverageWorkbook(file.name, Buffer.from(await file.arrayBuffer()), gateway) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function importCoverageAction(token: string, mapping: Record<string, string>) {
  await requireAdmin();
  try {
    const done = importCoverage(str(token, 64), mapping);
    revalidatePath("/coverage");
    return { done };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function removeCoverageAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  removeCoverage(str(fd.get("code"), 50));
  revalidatePath("/coverage");
  return { ok: "已移除，这个渠道改为只按接口试算结果判断" };
}

export async function setPrefilterAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const on = fd.get("on") === "1";
  setPrefilter(str(fd.get("code"), 50), on);
  revalidatePath("/coverage");
  return { ok: on ? "已打开：不在邮编表里的地址不再试算这个渠道" : "已关闭：邮编表只作参考" };
}

export async function clearBlocksAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  clearBlocks(str(fd.get("code"), 50) || undefined);
  revalidatePath("/coverage");
  return { ok: "已清除，下次试算会重新向 ShipBest 查询" };
}

export async function lookupZipAction(zip: string) {
  await requireAdmin();
  return lookupZip(str(zip, 10));
}

/* ---------------- 沙盒站：清空测试数据 ---------------- */

export async function resetSandboxAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  if (str(fd.get("confirm"), 20) !== "清空沙盒" && str(fd.get("confirm"), 20).toUpperCase() !== "RESET") return { error: "请输入“清空沙盒”确认" };
  try {
    const r = resetSandboxData();
    revalidatePath("/", "layout");
    return { ok: `沙盒数据已清空（订单 ${r.shipments} 张及相关流水、充值、批量导入、面单文件）。客户、渠道、价格和设置保留。` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ---------------- ShipBest 接口账号 ---------------- */

export async function saveShipBestAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const cur = getSettings().shipbest ?? { mode: "env", apiId: "", token: "" };
  const raw = fd.get("mode");
  // 正式站只能是正式模式（测试请到沙盒站）
  const mode = isProductionSite() ? "live" : raw === "live" || raw === "mock" || raw === "sandbox" ? raw : "env";
  const apiId = str(fd.get("apiId"), 100) || cur.apiId;
  const token = str(fd.get("token"), 200) || cur.token; // 留空 = 不修改
  const baseUrl = str(fd.get("baseUrl"), 200);
  if (baseUrl && !/^https:\/\/[^\s/]+/i.test(baseUrl)) return { error: "接口地址要以 https:// 开头" };
  const next = { mode, apiId, token, baseUrl } as const;
  saveSettings({ shipbest: next });
  // 切换模式 = 切换正式 / 测试数据；账号信息两边保持一致
  if (mode !== "env") {
    setStoredMode(mode);
    saveSettings({ shipbest: next });
  }
  clearChannelNameCache();
  revalidatePath("/", "layout");
  if (mode === "live" || mode === "sandbox") {
    if (!apiId || !token) return { error: "沙盒和正式模式都需要填写 API ID 和 Token" };
    try {
      await getShipBestClient().verify();
    } catch (e) {
      return { error: `已保存，但连接测试失败：${(e as Error).message}` };
    }
    if (shipbestMode() === "sandbox")
      return { ok: "已切换到沙盒模式，连接成功。请点“同步渠道”获取真实渠道；之后的报价是真实的，下单和面单是模拟的，不会扣费。" };
    return { ok: "已切换到正式模式，连接成功。请点“同步渠道”获取真实渠道，之后的报价和出单都是真实的。" };
  }
  return { ok: mode === "mock" ? "已切换到模拟模式（价格是模拟的，不会真实出单）" : "已保存" };
}

/* ---------------- 官网 ---------------- */

export async function updateLeadAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin({ staff: true });
  const raw = fd.get("status");
  const status = raw === "contacted" || raw === "done" || raw === "rejected" ? raw : "new";
  updateLead(Number(fd.get("id")), status, str(fd.get("adminNote"), 200) || null);
  revalidatePath("/leads");
  revalidatePath("/", "layout");
  return { ok: "已保存" };
}

export async function saveSiteAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  saveSettings({
    site: {
      company: str(fd.get("company"), 80),
      address: str(fd.get("address"), 120),
      contractAddress: str(fd.get("contractAddress"), 160),
      contractEmail: str(fd.get("contractEmail"), 80),
      phone: str(fd.get("phone"), 40),
      wechat: str(fd.get("wechat"), 40),
      email: str(fd.get("email"), 80),
      hours: str(fd.get("hours"), 80),
    },
  });
  revalidatePath("/site");
  return { ok: "已保存，官网上的联系方式已更新" };
}

/* ---------------- 嘉谷万邑 ---------------- */

export async function saveJiaguAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const cur = getSettings().jiagu ?? { enabled: false, clientId: "", secret: "", ownershipId: "", customerId: "", warehouseId: "" };
  const id = (k: string) => str(fd.get(k), 20).replace(/\D/g, "");
  const next = {
    ...cur,
    enabled: fd.get("enabled") === "1",
    clientId: str(fd.get("clientId"), 100),
    secret: str(fd.get("secret"), 200) || cur.secret, // 留空 = 不修改
    ownershipId: id("ownershipId"),
    customerId: id("customerId"),
    warehouseId: id("warehouseId"),
    // 每个渠道的仓库：表单里 wh_产品ID
    warehouses: Object.fromEntries(
      [...fd.keys()].filter((k) => /^wh_\d+$/.test(k)).map((k) => [k.slice(3), id(k)] as const).filter(([, v]) => v),
    ),
  };
  if (next.enabled && (!next.clientId || !next.secret || !next.ownershipId || !next.customerId)) {
    return { error: "启用前请填写 Client ID、Client Secret、权属 ID 和客户 ID" };
  }
  saveSettings({ jiagu: next });
  clearChannelNameCache();
  revalidatePath("/", "layout");
  if (!next.enabled) return { ok: "已保存（嘉谷已停用，嘉谷渠道暂时不能报价和下单）" };
  return jiaguStatus("已保存");
}

export async function saveDhlAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const cur = dhlSettings();
  const tpl = str(fd.get("labelTemplate"), 30);
  const origin = str(fd.get("originCountry"), 2).toUpperCase();
  const next: DhlSettings = {
    ...cur,
    enabled: fd.get("enabled") === "1",
    mode: fd.get("mode") === "live" ? "live" : "test",
    apiKey: str(fd.get("apiKey"), 200),
    apiSecret: str(fd.get("apiSecret"), 200) || cur.apiSecret, // 留空 = 不修改
    accountNumber: str(fd.get("accountNumber"), 20).replace(/\s/g, ""),
    labelTemplate: tpl in DHL_LABEL_TEMPLATES ? (tpl as DhlSettings["labelTemplate"]) : "ECOM26_A6_002",
    paperless: fd.get("paperless") !== "0",
    originCountry: /^[A-Z]{2}$/.test(origin) ? origin : "CN",
  };
  if (next.enabled && (!next.apiKey || !next.apiSecret || !next.accountNumber)) return { error: "启用前请填写 API Key、API Secret 和 DHL 付款账号" };
  saveSettings({ dhl: next });
  clearChannelNameCache();
  revalidatePath("/", "layout");
  if (!next.enabled) return { ok: "已保存（DHL 已停用，DHL 渠道暂时不能报价和下单）" };
  return dhlStatus("已保存");
}

export async function testDhlAction(_: FlashState): Promise<FlashState> {
  await requireAdmin();
  return dhlStatus("连接成功");
}

/** 测试连接：用发货地址到伦敦报一次价（只报价不下单） */
async function dhlStatus(prefix: string): Promise<FlashState> {
  const c = getDhlClient();
  if (!c) return { error: "DHL 没有启用或账号没填完整" };
  try {
    await c.verify();
    const synced = listChannels().some((ch) => isDhlCode(ch.code));
    return { ok: `${prefix}：DHL ${dhlSettings().mode === "live" ? "正式" : "测试"}环境报价正常。${synced ? "" : "点“物流渠道 → 同步渠道”把 DHL 渠道加进渠道列表。"}` };
  } catch (e) {
    return { error: `${prefix === "已保存" ? "已保存，但" : ""}连接测试失败：${(e as Error).message}` };
  }
}

export async function testJiaguAction(_: FlashState): Promise<FlashState> {
  await requireAdmin();
  return jiaguStatus("连接成功");
}

async function jiaguStatus(prefix: string): Promise<FlashState> {
  const c = getJiaguClient();
  if (!c) return { error: "嘉谷没有启用或账号没填完整" };
  try {
    const products = await c.getProducts();
    const bal = await c.balance().catch(() => null);
    const cfg = jiaguConfig()!;
    const noWh = products.filter((p) => !warehouseFor(cfg, Number(p.code.slice(JG_PREFIX.length)))).map((p) => p.name.replace(JG_SUFFIX, ""));
    // 还没同步进渠道列表的新渠道：用一个示例包裹试算一次（只算价，不下单），确认接口和仓库都通
    const known = new Set(listChannels().map((c) => c.code));
    const fresh = products.filter((p) => !known.has(p.code)).slice(0, 5);
    const tests: string[] = [];
    const st = getSettings();
    if (fresh.length && st.sender?.zipCode) {
      const sample: ShipmentRequest = {
        sender: st.sender,
        recipient: { nameFirst: "Test", nameLast: "Receiver", country: "US", province: "TX", city: "Austin", zipCode: "78701", address1: "500 Congress Ave", phone: "5125550100" },
        pkg: { length: 10, width: 8, height: 4, weight: 1, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
        skuList: [{ sku: "TEST", productNameCn: "测试", productNameEn: "Test item", quantity: 1, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 10, width: 8, height: 4, weight: 1, unit: 3 }],
      };
      for (const p of fresh) {
        const name = p.name.replace(JG_SUFFIX, "");
        try {
          const q = await c.trialPrice(p.code, sample);
          tests.push(q ? `${name} 试算成功：$${q.totalDiscountShippingFee.toFixed(2)}${q.zone ? `（${q.zone}）` : ""}` : `${name} 没有返回价格`);
        } catch (e) {
          tests.push(`${name} 试算失败：${(e as Error).message}`);
        }
      }
    }
    return {
      ok: `${prefix}：开通了 ${products.length} 个渠道${bal ? `，账户余额 $${bal.usd.toFixed(2)}${bal.type ? `（${bal.type}）` : ""}` : ""}。${fresh.length ? `新渠道（还没同步）：${fresh.map((p) => p.name.replace(JG_SUFFIX, "")).join("、")}。${tests.length ? `示例包裹（1 lb，10×8×4 in，寄到 Austin TX 78701，只算价不下单）${tests.join("；")}。` : ""}点上面的“同步渠道”把新渠道加进渠道列表。` : "渠道都已同步。"}${noWh.length ? `还没有仓库 ID 的渠道：${noWh.join("、")}` : ""}`,
    };
  } catch (e) {
    return { error: `${prefix}，但连接测试失败：${(e as Error).message}` };
  }
}

/* ---------------- 限时活动价 ---------------- */

export async function savePromotionAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id")) || null;
  const p = {
    channelCode: str(fd.get("channelCode"), 50),
    label: str(fd.get("label"), 30) || "限时折扣",
    rebatePercent: optNum(fd.get("rebatePercent")) ?? 0,
    customerPercent: optNum(fd.get("customerPercent")) ?? NaN,
    startsOn: str(fd.get("startsOn"), 10),
    endsOn: str(fd.get("endsOn"), 10),
    enabled: id ? fd.get("enabled") === "on" : true,
    note: str(fd.get("note"), 200) || null,
  };
  const err = validatePromotion(p);
  if (err) return { error: err };
  const saved = savePromotion(id, p);
  logMarkupChange({ scope: "channel", channelCode: p.channelCode, label: `限时活动 #${saved}「${p.label}」${p.startsOn} ~ ${p.endsOn}（返利 ${p.rebatePercent}%）`, before: null, after: { percent: p.customerPercent } });
  revalidatePath("/settings");
  return { ok: `活动已保存：${p.startsOn} 到 ${p.endsOn}，这个渠道给客户加价 ${p.customerPercent}%，扣掉返利后我们约赚成本的 ${Math.round((p.customerPercent + p.rebatePercent) * 10) / 10}%` };
}

export async function togglePromotionAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const p = getPromotion(Number(fd.get("id")));
  if (!p) return { error: "活动不存在" };
  if (fd.get("delete") === "1") deletePromotion(p.id);
  else savePromotion(p.id, { ...p, enabled: !p.enabled });
  revalidatePath("/settings");
  return { ok: fd.get("delete") === "1" ? "活动已删除" : p.enabled ? "活动已停用，恢复原来的加价" : "活动已启用" };
}

export async function saveChannelLimitsAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const keys = ["maxLb", "maxLongestIn", "maxSumIn", "maxGirthIn", "divisor", "minLongestIn", "minSecondIn"] as const;
  let n = 0;
  for (const c of listChannels(true)) {
    if (fd.get(`${c.code}.reset`) === "on") {
      saveLimits(c.code, null);
      continue;
    }
    const l = Object.fromEntries(keys.map((k) => [k, optNum(fd.get(`${c.code}.${k}`))])) as ChannelLimits;
    if (keys.some((k) => (l[k] ?? 0) < 0)) return { error: `${c.name}：限制不能是负数` };
    const def = defaultLimits(c.code, c.name);
    const same = (a: ChannelLimits | null) => keys.every((k) => (a?.[k] ?? null) === (l[k] ?? null));
    // 和默认值一样就不存（以后默认值更新了也跟着更新）；全空且没有默认值 = 不限制
    if (same(def) || (!def && keys.every((k) => l[k] == null))) saveLimits(c.code, null);
    else {
      saveLimits(c.code, l);
      n++;
    }
  }
  revalidatePath("/settings");
  return { ok: `已保存${n ? `（${n} 个渠道自定义）` : ""}，之后的报价按新的限制检查` };
}

export async function saveDimRuleAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const code = str(fd.get("code"), 50);
  const divisor = optNum(fd.get("divisor")) ?? 0;
  const minCubic = optNum(fd.get("minCubic")) ?? 0;
  if (divisor < 0 || minCubic < 0) return { error: "请填写正数" };
  saveDimRule(code, { divisor, minCubic });
  revalidatePath("/coverage");
  return { ok: "已保存" };
}

/* ---------------- 电商店铺（后台） ---------------- */

/** 后台给客户添加 / 修改 Shopify 店铺（Dev Dashboard 自定义 App 的 Client ID / Secret） */
export async function saveShopifyStoreAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const customerId = Number(fd.get("customerId"));
  if (!getCustomer(customerId)) return { error: "客户不存在" };
  try {
    const id = saveShopifyStore({
      id: Number(fd.get("id")) || null,
      customerId,
      shop: str(fd.get("shop"), 100),
      clientId: str(fd.get("clientId"), 100),
      clientSecret: str(fd.get("clientSecret"), 200) || undefined, // 留空 = 不修改
      installUrl: str(fd.get("installUrl"), 1000),
    });
    revalidatePath(`/customers/${customerId}`);
    const s = getStore(id)!;
    return { ok: s.status === "connected" ? "已保存" : s.installUrl ? "已保存。客户在“店铺订单”里会看到“去 Shopify 安装”按钮，也可以把安装链接直接发给客户" : "已保存。还没填安装链接：在 Shopify 应用的分发设置里生成后填上" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function syncStoreAdminAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const s = getStore(Number(fd.get("id")));
  if (!s) return { error: "店铺不存在" };
  try {
    const r = await syncStore(s.id);
    revalidatePath(`/customers/${s.customerId}`);
    return { ok: `同步完成：店铺里有 ${r.total} 个未发货订单，新增 ${r.added} 个` };
  } catch (e) {
    revalidatePath(`/customers/${s.customerId}`);
    return { error: `同步失败：${(e as Error).message}` };
  }
}

export async function removeStoreAdminAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const s = getStore(Number(fd.get("id")));
  if (!s) return { error: "店铺不存在" };
  if (fd.get("mode") === "delete") deleteStore(s.id);
  else disconnectStore(s.id);
  revalidatePath(`/customers/${s.customerId}`);
  return { ok: fd.get("mode") === "delete" ? "已删除店铺连接和同步的订单记录" : "已断开连接（订单记录保留）" };
}

export async function setStoresEnabledAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("customerId"));
  if (!getCustomer(id)) return { error: "客户不存在" };
  const on = fd.get("on") === "1";
  setStoresEnabled(id, on);
  revalidatePath(`/customers/${id}`);
  return { ok: on ? "已开放：客户 OMS 侧边栏会出现“店铺订单”" : "已关闭：客户看不到“店铺订单”，已连接的店铺暂停同步" };
}

export async function saveEbayAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const cur = ebaySettings();
  const next: EbaySettings = {
    enabled: fd.get("enabled") === "1",
    env: fd.get("env") === "production" ? "production" : "sandbox",
    clientId: str(fd.get("clientId"), 200),
    clientSecret: str(fd.get("clientSecret"), 200) || cur.clientSecret, // 留空 = 不修改
    ruName: str(fd.get("ruName"), 200),
    verificationToken: str(fd.get("verificationToken"), 80) || cur.verificationToken,
  };
  if (next.enabled && (!next.clientId || !next.clientSecret || !next.ruName)) return { error: "启用前请填写 App ID、Cert ID 和 RuName" };
  if (next.verificationToken && !/^[A-Za-z0-9_-]{32,80}$/.test(next.verificationToken)) return { error: "验证令牌要 32–80 位（字母、数字、_ 或 -）" };
  saveSettings({ ebay: next });
  revalidatePath("/settings");
  return { ok: next.enabled ? "已保存。客户可以在客户中心“店铺订单”里点“连接 eBay”授权" : "已保存（eBay 对接已停用）" };
}

/* ---------------- 开放 API（后台） ---------------- */

export async function setApiEnabledAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("customerId"));
  if (!getCustomer(id)) return { error: "客户不存在" };
  const on = fd.get("on") === "1";
  const { setApiEnabled } = await import("@/lib/api/keys");
  setApiEnabled(id, on);
  revalidatePath(`/customers/${id}`);
  return { ok: on ? "已开通：客户 OMS 侧边栏会出现“API 对接”，可以自己生成密钥" : "已关闭：这个客户的所有 API 密钥暂停使用" };
}

export async function adminRevokeApiKeyAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const { getKey, revokeKey } = await import("@/lib/api/keys");
  const k = getKey(Number(fd.get("id")));
  if (!k) return { error: "密钥不存在" };
  revokeKey(k.id);
  revalidatePath(`/customers/${k.customerId}`);
  return { ok: "已作废" };
}
