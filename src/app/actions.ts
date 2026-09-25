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
} from "@/lib/db";
import type { PartialRule } from "@/lib/pricing";
import { getShipBestClient, shipbestMode } from "@/lib/shipbest/client";
import { saveDimRule } from "@/lib/rates";
import { CARRIERS } from "@/lib/carriers";
import { clearChannelNameCache, sameNameChannels } from "@/lib/channelDisplay";
import { clearTestData } from "@/lib/cleanup";
import { getJiaguClient, jiaguConfig, JG_PREFIX, JG_SUFFIX, warehouseFor } from "@/lib/shipbest/jiagu";
import { createBackup, deleteBackup, restoreBackup } from "@/lib/backup";
import { resetTestEnv, setStoredMode } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { checkFinancePin, setFinancePin } from "@/lib/financePin";
import { testAddressService } from "@/lib/addressCheck";
import { listSenders, saveSender } from "@/lib/senders";
import { clearCredentials, readablePassword, rememberCredentials } from "@/lib/credentials";
import { clearBlocks, importCoverage, lookupZip, parseCoverageWorkbook, removeCoverage, setPrefilter } from "@/lib/coverage";
import { addLedger, balanceOf, postAdjustment } from "@/lib/ledger";
import { getT } from "@/lib/prefs";
import { isUsZip } from "@/lib/geo";
import { saveChannelSample } from "@/lib/labels";
import { approveTopup, rejectTopup, saveAlipayQr } from "@/lib/topup";
import { usdCnyQuote } from "@/lib/fx";
import { adminResetFromRequest } from "@/lib/passwordReset";
import type { Address, ShipmentRequest } from "@/lib/shipbest/types";
import { cleanAddress, cleanRequest, n, optNum, str, unit } from "@/lib/sanitize";
import type { StampConfig, StampOverride, StampSettings } from "@/lib/stampConfig";
import {
  confirmCancelled,
  createLabel,
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

/** 后台运费试算（不出单）：选已有客户按他的渠道和加价；不选客户则按临时加价试算所有渠道 */
export async function quoteAction(
  customerId: number,
  raw: ShipmentRequest,
  markup?: PartialRule,
): Promise<{ errors?: string[]; quotes?: ChannelQuote[] }> {
  await requireAdmin();
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
    return { quotes: customerId ? await quoteAll(customerId, req) : await quoteForProspect(req, m) };
  } catch (e) {
    return { errors: [(e as Error).message] };
  }
}

// 后台不出面单：出单都在客户 OMS 里进行（后台可以“进入客户 OMS”代客户操作）

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
  const isNew = !(idRaw > 0);
  const email = str(fd.get("email"), 100).toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "邮箱格式不正确" };
  // 新客户：邮箱就是 OMS 登录账号，保存时直接开通登录并生成初始密码
  if (isNew && email && portalEmailTaken(email)) return { error: "这个邮箱已经被其他客户用作登录账号" };
  const neg = negativeRule(ruleFromForm(fd));
  if (neg) return { error: neg };
  const savedId = saveCustomer(isNew ? null : idRaw, {
    name,
    contact: str(fd.get("contact")) || null,
    phone: str(fd.get("phone")) || null,
    email,
    note: str(fd.get("note"), 1000) || null,
    markup: ruleFromForm(fd),
  });
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
  await requireAdmin();
  clearCredentials(id);
  revalidatePath(`/customers/${id}`);
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
  await requireAdmin();
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
  await requireAdmin();
  const pinErr = checkFinancePin(str(fd.get("financePin"), 10));
  if (pinErr) return { error: pinErr };
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
  // 设置页已不再编辑发货仓地址：表单里没有这些字段时保留原值
  if ([...fd.keys()].some((k) => k.startsWith("sender."))) patch.sender = sender.nameFirst || sender.address1 ? sender : null;
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

export async function resetTestEnvAction(_: FlashState): Promise<FlashState> {
  await requireAdmin();
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
  // 同一个客户不能开通两个客户看起来一样的渠道（例如两家服务商的 USPS）：客户分不清，只能选一个
  const clash = sameNameChannels(codes);
  if (clash) return { error: `“${clash.publicName}”开通了 ${clash.names.length} 个（${clash.names.join("、")}），客户看到的名称一样，只能选一个` };
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
  const pinErr = checkFinancePin(str(fd.get("financePin"), 10));
  if (pinErr) return { error: pinErr };
  let id = 0;
  try {
    id = Number(fd.get("id"));
    approveTopup(id, n(fd.get("creditedUsd")), str(fd.get("adminNote"), 200) || null);
    revalidatePath("/finance");
  } catch (e) {
    return { error: (e as Error).message };
  }
  // 处理完这一行会从“待确认”里消失，FlashForm 的提示也跟着没了：跳回财务页，由页面顶部显示结果
  redirect(`/finance?done=approved&id=${id}#topups`);
}

export async function rejectTopupAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  let id = 0;
  try {
    id = Number(fd.get("id"));
    rejectTopup(id, str(fd.get("adminNote"), 200));
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

/* ---------------- ShipBest 接口账号 ---------------- */

export async function saveShipBestAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const cur = getSettings().shipbest ?? { mode: "env", apiId: "", token: "" };
  const raw = fd.get("mode");
  const mode = raw === "live" || raw === "mock" || raw === "sandbox" ? raw : "env";
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
    return {
      ok: `${prefix}：开通了 ${products.length} 个渠道${bal ? `，账户余额 $${bal.usd.toFixed(2)}${bal.type ? `（${bal.type}）` : ""}` : ""}。点上面的“同步渠道”把嘉谷渠道加进渠道列表。${noWh.length ? `还没有仓库 ID 的渠道：${noWh.join("、")}` : ""}`,
    };
  } catch (e) {
    return { error: `${prefix}，但连接测试失败：${(e as Error).message}` };
  }
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
