"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { checkStaffTopup } from "@/lib/topup";
import type { FlashState } from "@/app/actions";

/** 主管理员核对管理员记的充值（确认钱到了公司 / 已经处理好） */
export async function checkStaffTopupAction(_: FlashState, fd: FormData): Promise<FlashState> {
  const who = await requireAdmin();
  try {
    checkStaffTopup(Number(fd.get("id")), String(fd.get("note") ?? ""), who.name || "主管理员");
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/finance");
  revalidatePath("/");
  return { ok: "已核对" };
}
