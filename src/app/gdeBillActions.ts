"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { buildGdePreview, deleteGdeBill, importGdeBill, parseGdeWorkbook, reopenBillIssue, resolveBillIssue, revokeGdeRefunds, type GdePreview } from "@/lib/gdeBill";
import type { FlashState } from "@/app/actions";

/** 读上传的嘉谷对账单 */
async function readBill(fd: FormData) {
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) throw new Error("请选择文件");
  if (file.size > 10 * 1024 * 1024) throw new Error("文件不能超过 10MB");
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("请上传嘉谷发来的 .xlsx 账单");
  const wb = await parseGdeWorkbook(Buffer.from(await file.arrayBuffer()));
  if (!wb) throw new Error("这个文件不是嘉谷的对账单格式（没找到“运单号 / 客户单号 / 总金额”这些列）。其他补差表格请用下面的“上传补差表格”");
  return { name: file.name.slice(0, 200), wb, opts: { baseDiff: fd.get("baseDiff") === "1" } };
}

/** 分析账单（不写数据） */
export async function previewGdeBillAction(fd: FormData): Promise<{ error?: string; preview?: GdePreview; filename?: string }> {
  await requireAdmin();
  try {
    const { name, wb, opts } = await readBill(fd);
    return { preview: buildGdePreview(wb, opts), filename: name };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** 确认导入：重新读一遍上传的文件（不用浏览器传回来的分析结果） */
export async function importGdeBillAction(fd: FormData): Promise<{ error?: string; billId?: number }> {
  await requireAdmin();
  try {
    const { name, wb, opts } = await readBill(fd);
    const r = importGdeBill(name, wb, opts);
    revalidatePath("/adjustments");
    return { billId: r.billId };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteGdeBillAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  deleteGdeBill(Number(fd.get("id")));
  revalidatePath("/adjustments");
  redirect("/adjustments");
}

/** 嘉谷账单待核对：和嘉谷沟通完，标记已处理 */
export async function resolveBillIssueAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const who = await requireAdmin();
  const note = String(fd.get("note") ?? "").trim();
  if (!note) return { error: "请写一句处理结果，例如“嘉谷已同意退款”" };
  try {
    resolveBillIssue(Number(fd.get("id")), note, who.name || "主管理员");
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/adjustments/gde/review");
  return { ok: "已标记处理" };
}

export async function reopenBillIssueAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  reopenBillIssue(Number(fd.get("id")));
  revalidatePath("/adjustments/gde/review");
  return { ok: "已重新打开" };
}

/** 只补不退之前导入的账单：撤回当时退给客户的补差 */
export async function revokeGdeRefundsAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id"));
  const n = revokeGdeRefunds(id);
  revalidatePath("/adjustments");
  revalidatePath(`/adjustments/gde/${id}`);
  return { ok: n ? `已撤回 ${n} 笔退给客户的补差（改成只记成本）` : "没有退给客户的补差" };
}
