"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkPassword, checkRateLimit, clearFailures, createSession, destroySession, hashPassword, recordFailure, requireAdmin } from "@/lib/auth";
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
  type Settings,
  getCustomer,
} from "@/lib/db";
import type { PartialRule } from "@/lib/pricing";
import { addLedger, balanceOf, postAdjustment } from "@/lib/ledger";
import { saveChannelSample } from "@/lib/labels";
import { approveTopup, rejectTopup, saveAlipayQr } from "@/lib/topup";
import { usdCnyQuote } from "@/lib/fx";
import { adminResetFromRequest } from "@/lib/passwordReset";
import { getShipBestClient } from "@/lib/shipbest/client";
import type { Address, ShipmentRequest } from "@/lib/shipbest/types";
import { cleanAddress, cleanRequest, n, optNum, str, unit } from "@/lib/sanitize";
import type { StampConfig, StampOverride, StampSettings } from "@/lib/stampConfig";
import {
  confirmCancelled,
  createLabel,
  PriceChangedError,
  quoteAll,
  withdrawCancel,
  refreshShipment,
  requestCancel,
  syncChannels,
  validateRequest,
  type ChannelQuote,
} from "@/lib/service";

/* ---------------- 登录 ---------------- */

export async function loginAction(_: unknown, fd: FormData) {
  const key = "admin:" + ((await headers()).get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const limited = checkRateLimit(key);
  if (limited) return { error: limited };
  if (!checkPassword(String(fd.get("password") ?? ""))) {
    recordFailure(key);
    return { error: "密码错误" };
  }
  clearFailures(key);
  await createSession();
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

/* ---------------- 报价 / 出单 ---------------- */

export async function quoteAction(
  customerId: number,
  raw: ShipmentRequest,
): Promise<{ errors?: string[]; quotes?: ChannelQuote[] }> {
  await requireAdmin();
  const req = cleanRequest(raw);
  if (!customerId) return { errors: ["请选择客户"] };
  const errors = validateRequest(req);
  if (errors.length) return { errors };
  try {
    return { quotes: await quoteAll(customerId, req) };
  } catch (e) {
    return { errors: [(e as Error).message] };
  }
}

export async function createAction(input: {
  customerId: number;
  channelCode: string;
  req: ShipmentRequest;
  expectedPrice: number;
  remark?: string;
  customerRef?: string;
}): Promise<{ id?: number; error?: string; quote?: ChannelQuote }> {
  await requireAdmin();
  try {
    const id = await createLabel({
      customerId: Number(input.customerId),
      channelCode: str(input.channelCode),
      req: cleanRequest(input.req),
      expectedPrice: n(input.expectedPrice),
      remark: str(input.remark, 200) || undefined,
      customerRef: str(input.customerRef, 50) || undefined,
      createdBy: "admin",
    });
    revalidatePath("/shipments");
    return { id };
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

/** 加价不允许负数（会低于成本出单） */
function negativeRule(r: PartialRule, who = ""): string | null {
  return [r.percent, r.fixed, r.minProfit].some((v) => v !== null && v !== undefined && v < 0)
    ? `${who}加价、固定加价、最低利润不能为负数（会低于成本出单）`
    : null;
}

export async function saveCustomerAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const name = str(fd.get("name"));
  if (!name) return { error: "客户名称必填" };
  const idRaw = Number(fd.get("id"));
  const neg = negativeRule(ruleFromForm(fd));
  if (neg) return { error: neg };
  const savedId = saveCustomer(idRaw > 0 ? idRaw : null, {
    name,
    contact: str(fd.get("contact")) || null,
    phone: str(fd.get("phone")) || null,
    email: str(fd.get("email")) || null,
    note: str(fd.get("note"), 1000) || null,
    markup: ruleFromForm(fd),
  });
  revalidatePath("/customers");
  // 新客户保存后进入详情页，继续开通登录、充值
  if (!(idRaw > 0)) redirect(`/customers/${savedId}`);
  return { ok: "已保存" };
}

export async function saveCustomerPortalAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id"));
  const email = str(fd.get("portalEmail"), 100).toLowerCase() || null;
  const enabled = fd.get("portalEnabled") === "on";
  if (enabled && !email) return { error: "开通登录需要填写登录邮箱" };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "登录邮箱格式不正确" };
  try {
    updateCustomerPortal(id, { email, enabled, creditLimit: Math.max(0, optNum(fd.get("creditLimit")) ?? 0) });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/customers/${id}`);
  return { ok: enabled && !getPasswordHash(id) ? "已保存。还没有设置密码，请在下方设置登录密码。" : "已保存" };
}

export async function setCustomerPasswordAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id"));
  let pw = String(fd.get("password") ?? "").trim();
  const generated = !pw;
  if (generated) pw = randomBytes(6).toString("base64url");
  if (pw.length < 8 && !generated) return { error: "密码至少 8 位（留空则自动生成）" };
  setCustomerPassword(id, hashPassword(pw));
  revalidatePath(`/customers/${id}`);
  return { ok: `密码已设置为：${pw}　请发给客户，客户登录后可以自己修改。这个密码只显示这一次。` };
}

export async function saveCustomerSenderAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id"));
  const sender = cleanAddress(Object.fromEntries([...fd.entries()].filter(([k]) => k.startsWith("sender.")).map(([k, v]) => [k.slice(7), v])) as Partial<Address>);
  setCustomerSender(id, sender.nameFirst || sender.address1 ? sender : null);
  revalidatePath(`/customers/${id}`);
  return { ok: "寄件地址已保存" };
}

export async function ledgerEntryAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id"));
  const type = fd.get("type") === "manual" ? "manual" : "topup";
  const amount = optNum(fd.get("amount"));
  if (!amount) return { error: fd.get("amount") ? "金额不能为 0" : "请填写金额" };
  if (type === "topup" && amount < 0) return { error: "充值金额必须为正数；扣款请选“手动调账”并填负数" };
  const note = str(fd.get("note"), 200) || null;
  if (type === "manual" && !note) return { error: "手动调账请填写说明" };
  addLedger({ customerId: id, type, amount, note, createdBy: "admin" });
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
    sbCancelFeePercent: optNum(fd.get("sbCancelFeePercent")) ?? cur.sbCancelFeePercent,
    defaultUnit: unit(fd.get("defaultUnit")),
    defaultCurrency: str(fd.get("defaultCurrency"), 3).toUpperCase() || "USD",
    adjustmentPolicy: (["at_cost", "with_markup", "none"] as const).find((p) => p === fd.get("adjustmentPolicy")) ?? cur.adjustmentPolicy,
    brandName: str(fd.get("brandName"), 60) || cur.brandName,
    balanceRule: fd.get("balanceRule") === "cover" ? "cover" : "positive",
    supportContact: str(fd.get("supportContact"), 200),
  };
  const sender = cleanAddress(Object.fromEntries([...fd.entries()].filter(([k]) => k.startsWith("sender.")).map(([k, v]) => [k.slice(7), v])) as Partial<Address>);
  patch.sender = sender.nameFirst || sender.address1 ? sender : null;
  saveSettings(patch);
  revalidatePath("/settings");
  return { ok: "设置已保存" };
}

export async function saveChannelsAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  for (const c of listChannels()) {
    const neg = negativeRule(ruleFromForm(fd, `${c.code}.`), `${c.name}：`);
    if (neg) return { error: neg };
  }
  for (const c of listChannels()) {
    updateChannel(c.code, fd.get(`enabled.${c.code}`) === "on", ruleFromForm(fd, `${c.code}.`));
  }
  revalidatePath("/settings");
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
  // 关联到异常状态的面单时先提醒，勾选“仍然关联”后再提交
  if (fd.get("force") !== "1") {
    const warn: string[] = [];
    if (s.status === "cancelled") warn.push("这张面单已经取消");
    if (s.status === "exception") warn.push("这张面单是异常状态");
    if (adj.reason && s.channelName && !sameCarrier(adj.reason, s.channelName)) warn.push(`补差原因里的渠道和面单渠道（${s.channelName}）可能不一致`);
    if (warn.length) return { error: `${warn.join("；")}。确认没关联错的话，勾选“仍然关联”再提交。` };
  }
  const amount = customerAmountFor(adj.cost_amount, adj.policy, s.rule);
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
  await requireAdmin();
  const id = Number(fd.get("id"));
  if (!getCustomer(id)) return { error: "客户不存在" };
  const codes = fd.getAll("channels").map((v) => str(v, 50)).filter(Boolean);
  setCustomerChannels(id, codes);
  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
  return { ok: codes.length ? `已保存，开通 ${codes.length} 个渠道` : "已保存：这个客户现在没有可用渠道，无法下单" };
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
  await requireAdmin();
  try {
    const id = Number(fd.get("id"));
    approveTopup(id, n(fd.get("creditedUsd")), str(fd.get("adminNote"), 200) || null);
    revalidatePath("/finance");
    return { ok: `#${id} 已入账` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function rejectTopupAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  try {
    const id = Number(fd.get("id"));
    rejectTopup(id, str(fd.get("adminNote"), 200));
    revalidatePath("/finance");
    return { ok: `#${id} 已拒绝` };
  } catch (e) {
    return { error: (e as Error).message };
  }
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
    fxMarkup: markup ?? cur.fxMarkup,
    fxManualRate: manual ?? cur.fxManualRate,
  });
  const file = fd.get("alipayQr");
  if (file instanceof File && file.size) {
    if (file.size > 3 * 1024 * 1024) return { error: "收款码图片不能超过 3MB" };
    try {
      saveAlipayQr(Buffer.from(await file.arrayBuffer()));
      saveSettings({ alipayQr: true });
    } catch (e) {
      return { error: (e as Error).message };
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
  await requireAdmin();
  try {
    const r = adminResetFromRequest(Number(fd.get("id")));
    revalidatePath("/customers");
    return { ok: `${r.customerName} 的新密码：${r.password}　请发给客户（只显示这一次）` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
