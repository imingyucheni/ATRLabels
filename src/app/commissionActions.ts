"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { assignCustomer, deleteAssignment, saveSales, settle } from "@/lib/commission";
import { checkFinancePin } from "@/lib/financePin";
import { money } from "@/lib/pricing";
import { getT } from "@/lib/prefs";
import { str } from "@/lib/sanitize";
import type { FlashState } from "@/app/actions";

const fail = async (e: unknown): Promise<FlashState> => ({ error: (await getT())((e as Error).message) });

/** 新增 / 修改销售 */
export async function saveSalesAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  try {
    const id = saveSales({
      id: Number(fd.get("id")) || undefined,
      name: str(fd.get("name"), 60),
      phone: str(fd.get("phone"), 40) || null,
      email: str(fd.get("email"), 120) || null,
      rate: Number(str(fd.get("rate"), 10)),
      note: str(fd.get("note"), 200) || null,
      active: fd.get("active") !== "0",
    });
    revalidatePath("/commissions");
    revalidatePath(`/commissions/${id}`);
    return { ok: fd.get("id") ? "已保存" : "已添加销售" };
  } catch (e) {
    return fail(e);
  }
}

/** 客户归属销售：全部订单 / 从某天起 */
export async function assignSalesAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const customerId = Number(fd.get("customerId"));
  try {
    const rawSales = str(fd.get("salesId"), 10);
    const rawRate = str(fd.get("rate"), 10);
    const startDate = fd.get("scope") === "from" ? str(fd.get("startDate"), 10) : "";
    if (fd.get("scope") === "from" && !startDate) return { error: (await getT())("请选择从哪天开始生效") };
    assignCustomer(customerId, { salesId: rawSales ? Number(rawSales) : null, rate: rawRate === "" ? null : Number(rawRate), startDate, by: "admin" });
    revalidatePath(`/customers/${customerId}`);
    revalidatePath("/commissions", "layout");
    return { ok: "已保存销售归属" };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAssignmentAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const customerId = Number(fd.get("customerId"));
  deleteAssignment(customerId, Number(fd.get("id")));
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/commissions", "layout");
  return { ok: "已删除这条记录" };
}

/** 结算佣金：截至某天未结的一次结清（需要财务确认密码） */
export async function settleCommissionAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const pinErr = checkFinancePin(str(fd.get("financePin"), 10));
  const t = await getT();
  if (pinErr) return { error: t(pinErr) };
  const salesId = Number(fd.get("salesId"));
  try {
    const p = settle(salesId, str(fd.get("upTo"), 10), str(fd.get("note"), 200) || null, "admin");
    revalidatePath(`/commissions/${salesId}`);
    revalidatePath("/commissions");
    if (!p) return { error: t("截至这天没有需要结算的佣金") };
    return { ok: t("已结算 {amt}（{n} 单）", { amt: money(p.amount), n: p.orders }) };
  } catch (e) {
    return fail(e);
  }
}
