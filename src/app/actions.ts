"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkPassword, createSession, destroySession, requireAdmin } from "@/lib/auth";
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
  getSettings,
  linkAdjustment,
  listChannels,
  saveCustomer,
  saveSettings,
  updateChannel,
  type Settings,
} from "@/lib/db";
import type { PartialRule } from "@/lib/pricing";
import { postAdjustment } from "@/lib/ledger";
import { getShipBestClient } from "@/lib/shipbest/client";
import type { Address, ShipmentRequest, SkuItem, UnitSystem } from "@/lib/shipbest/types";
import {
  confirmCancelled,
  createLabel,
  PriceChangedError,
  quoteAll,
  refreshShipment,
  requestCancel,
  syncChannels,
  validateRequest,
  type ChannelQuote,
} from "@/lib/service";

/* ---------------- 工具 ---------------- */

function str(v: unknown, max = 200): string {
  return (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v)).trim().slice(0, max);
}
function n(v: unknown): number {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
}
function optNum(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const x = parseFloat(s);
  return Number.isFinite(x) ? x : null;
}
function unit(v: unknown): UnitSystem {
  const u = Number(v);
  return u === 1 || u === 2 || u === 3 ? u : 1;
}

function cleanAddress(a: Partial<Address> | undefined): Address {
  const x = a ?? {};
  const out: Address = {
    nameFirst: str(x.nameFirst),
    nameLast: str(x.nameLast),
    country: str(x.country, 2).toUpperCase(),
    city: str(x.city),
    address1: str(x.address1),
    zipCode: str(x.zipCode),
  };
  for (const k of ["phone", "email", "corporateName", "taxIdValue", "province", "area", "street", "houseNumber", "address2"] as const) {
    const v = str(x[k]);
    if (v) out[k] = v;
  }
  return out;
}

/** 客户端传来的数据不可信：统一转换类型、去掉多余字段。 */
function cleanRequest(raw: ShipmentRequest): ShipmentRequest {
  const p = raw?.pkg ?? ({} as ShipmentRequest["pkg"]);
  const sig = Number(p.signServiceType);
  return {
    sender: cleanAddress(raw?.sender),
    recipient: cleanAddress(raw?.recipient),
    pkg: {
      length: n(p.length),
      width: n(p.width),
      height: n(p.height),
      weight: n(p.weight),
      displayUnitSystem: unit(p.displayUnitSystem),
      signServiceType: (sig >= 0 && sig <= 3 ? sig : 0) as 0 | 1 | 2 | 3,
      insuranceService: Number(p.insuranceService) === 1 ? 1 : 0,
      insuranceFee: n(p.insuranceFee) || undefined,
      currency: str(p.currency, 3).toUpperCase() || "USD",
    },
    skuList: (Array.isArray(raw?.skuList) ? raw.skuList : []).slice(0, 50).map(
      (s: Partial<SkuItem>): SkuItem => ({
        sku: str(s.sku, 100),
        productNameCn: str(s.productNameCn),
        productNameEn: str(s.productNameEn),
        quantity: Math.round(n(s.quantity)),
        declaredUnitPrice: n(s.declaredUnitPrice),
        declaredCurrency: str(s.declaredCurrency, 3).toUpperCase() || "USD",
        hsCode: str(s.hsCode, 20),
        productNature: str(s.productNature, 20),
        length: n(s.length),
        width: n(s.width),
        height: n(s.height),
        weight: n(s.weight),
        unit: unit(s.unit),
      }),
    ),
  };
}

/* ---------------- 登录 ---------------- */

export async function loginAction(_: unknown, fd: FormData) {
  if (!checkPassword(String(fd.get("password") ?? ""))) return { error: "密码错误" };
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
}): Promise<{ id?: number; error?: string; quote?: ChannelQuote }> {
  await requireAdmin();
  try {
    const id = await createLabel({
      customerId: Number(input.customerId),
      channelCode: str(input.channelCode),
      req: cleanRequest(input.req),
      expectedPrice: n(input.expectedPrice),
      remark: str(input.remark, 200) || undefined,
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

export async function saveCustomerAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const name = str(fd.get("name"));
  if (!name) return { error: "客户名称必填" };
  const idRaw = Number(fd.get("id"));
  saveCustomer(idRaw > 0 ? idRaw : null, {
    name,
    contact: str(fd.get("contact")) || null,
    phone: str(fd.get("phone")) || null,
    email: str(fd.get("email")) || null,
    note: str(fd.get("note"), 1000) || null,
    markup: ruleFromForm(fd),
  });
  revalidatePath("/customers");
  redirect("/customers");
}

/* ---------------- 设置 ---------------- */

export async function saveSettingsAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const cur = getSettings();
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
  const amount = customerAmountFor(adj.cost_amount, adj.policy, s.rule);
  linkAdjustment(adj.id, s.id, s.customerId, amount);
  postAdjustment(adj.id, s.customerId, s.id, amount, null);
  revalidatePath(`/adjustments`);
  return { ok: `已关联到 ${s.customNo}（${s.customerName}）` };
}
