"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireCustomer } from "@/lib/auth";
import { houseCustomerId } from "@/lib/db";
import { deleteDraft, saveDraft } from "@/lib/drafts";
import { tMsg } from "@/lib/prefs";
import type { ShipmentRequest } from "@/lib/shipbest/types";

/** portal = 客户自己的草稿；house = 管理员自用下单的草稿（存在公司自用账户下） */
export type DraftScope = "portal" | "house";

async function ownerOf(scope: DraftScope): Promise<number> {
  if (scope === "house") {
    await requireAdmin();
    return houseCustomerId();
  }
  return (await requireCustomer()).id;
}

const pages = (scope: DraftScope) => (scope === "house" ? ["/ship", "/ship/intl"] : ["/portal/ship", "/portal/intl"]);

export async function saveDraftAction(input: { scope: DraftScope; id?: number; intl: boolean; request: ShipmentRequest; customerRef?: string; remark?: string }): Promise<{ id?: number; error?: string }> {
  const owner = await ownerOf(input.scope);
  try {
    const id = saveDraft(owner, { id: Number(input.id) || undefined, intl: !!input.intl, request: input.request, customerRef: input.customerRef, remark: input.remark });
    pages(input.scope).forEach((p) => revalidatePath(p));
    return { id };
  } catch (e) {
    return { error: await tMsg((e as Error).message) };
  }
}

export async function deleteDraftAction(input: { scope: DraftScope; id: number }): Promise<{ ok: boolean }> {
  const owner = await ownerOf(input.scope);
  const ok = deleteDraft(owner, Number(input.id));
  pages(input.scope).forEach((p) => revalidatePath(p));
  return { ok };
}
