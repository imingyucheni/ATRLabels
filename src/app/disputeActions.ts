"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createDispute, deleteDispute, getDispute, loseDispute, reopenDispute, winDispute } from "@/lib/disputes";
import type { FlashState } from "@/app/actions";

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[,$\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error("金额格式不对");
  return n;
};
const text = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max);

function refresh(shipmentId?: number) {
  if (shipmentId) revalidatePath(`/shipments/${shipmentId}`);
  revalidatePath("/disputes");
  revalidatePath("/adjustments");
}

/** 记录申诉；服务商已经退回的话（填了退回金额）直接记成功并退给客户 */
export async function createDisputeAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const who = await requireAdmin();
  const shipmentId = Number(fd.get("shipmentId"));
  try {
    const id = createDispute(shipmentId, { reason: text(fd.get("reason"), 200), claimAmount: num(fd.get("claimAmount")), note: text(fd.get("note"), 500) }, who.name);
    const refundCost = num(fd.get("refundCost"));
    if (refundCost !== null) {
      const r = winDispute(id, { refundCost, refundCustomer: num(fd.get("refundCustomer")) }, who.name);
      refresh(shipmentId);
      return { ok: `已记录申诉成功：服务商退回 ${r.refundCost.toFixed(2)}，退给客户 ${r.refundCustomer.toFixed(2)}` };
    }
    refresh(shipmentId);
    return { ok: "已记录申诉（申诉中）" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function winDisputeAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const who = await requireAdmin();
  const id = Number(fd.get("id"));
  try {
    const refundCost = num(fd.get("refundCost"));
    if (refundCost === null) return { error: "请填服务商退回的金额" };
    const r = winDispute(id, { refundCost, refundCustomer: num(fd.get("refundCustomer")), note: text(fd.get("note"), 500) }, who.name);
    refresh(getDispute(id)?.shipmentId);
    return { ok: `已记录申诉成功：服务商退回 ${r.refundCost.toFixed(2)}，退给客户 ${r.refundCustomer.toFixed(2)}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function loseDisputeAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const who = await requireAdmin();
  const id = Number(fd.get("id"));
  try {
    loseDispute(id, text(fd.get("note"), 500), who.name);
    refresh(getDispute(id)?.shipmentId);
    return { ok: "已记录申诉未成功" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function reopenDisputeAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id"));
  try {
    reopenDispute(id);
    refresh(getDispute(id)?.shipmentId);
    return { ok: "已撤销处理结果，回到申诉中（退给客户的钱已撤回）" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteDisputeAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id"));
  const sid = getDispute(id)?.shipmentId;
  try {
    deleteDispute(id);
    refresh(sid);
    return { ok: "已删除" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
