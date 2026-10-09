"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { getT } from "@/lib/prefs";
import { str } from "@/lib/sanitize";
import { accessOf, createStaff, deleteStaff, getStaff, listStaff, renameStaff, setStaffAccess, setStaffActive, setStaffPassword, setStaffPin } from "@/lib/staffStore";
import type { FlashState } from "@/app/actions";

const fail = async (e: unknown): Promise<FlashState> => ({ error: (await getT())((e as Error).message) });

/* ---------- 主管理员管理员工账号 ---------- */

export async function createStaffAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  try {
    createStaff({ name: str(fd.get("name"), 40), username: str(fd.get("username"), 32), password: String(fd.get("password") ?? "") });
    revalidatePath("/staff");
    return { ok: "已创建员工账号，把登录名和密码发给他。他第一次登录后要在“我的账号”里设置自己的 4 位确认密码" };
  } catch (e) {
    return fail(e);
  }
}

export async function updateStaffAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id"));
  try {
    const op = String(fd.get("op") ?? "");
    if (op === "rename") renameStaff(id, str(fd.get("name"), 40));
    else if (op === "password") setStaffPassword(id, String(fd.get("password") ?? ""));
    else if (op === "disable") setStaffActive(id, false);
    else if (op === "enable") setStaffActive(id, true);
    else if (op === "delete") deleteStaff(id);
    else return { error: "未知操作" };
    revalidatePath("/staff");
    const msg: Record<string, string> = { rename: "已改名", password: "密码已重置，他之前的登录已失效", disable: "已停用，他之前的登录已失效", enable: "已启用", delete: "已删除" };
    return { ok: msg[op] };
  } catch (e) {
    return fail(e);
  }
}

/* ---------- 员工自己：确认密码、登录密码 ---------- */

async function me() {
  const who = await requireAdmin({ staff: true });
  if (who.role !== "staff") throw new Error("主管理员的确认密码在“设置 → 财务确认密码”里设置");
  return getStaff(who.id)!;
}

export async function setMyPinAction(_: FlashState, fd: FormData): Promise<FlashState> {
  try {
    const s = await me();
    if (!verifyPassword(String(fd.get("password") ?? ""), s.pwHash)) return { error: (await getT())("登录密码不正确") };
    const pin = str(fd.get("pin"), 4);
    if (pin !== str(fd.get("pin2"), 4)) return { error: (await getT())("两次输入的确认密码不一样") };
    setStaffPin(s.id, pin);
    revalidatePath("/account");
    return { ok: "确认密码已保存，确认充值时输入它" };
  } catch (e) {
    return fail(e);
  }
}

export async function changeMyPasswordAction(_: FlashState, fd: FormData): Promise<FlashState> {
  try {
    const s = await me();
    if (!verifyPassword(String(fd.get("old") ?? ""), s.pwHash)) return { error: (await getT())("原密码不正确") };
    const pw = String(fd.get("password") ?? "");
    if (pw !== String(fd.get("password2") ?? "")) return { error: (await getT())("两次输入的新密码不一样") };
    setStaffPassword(s.id, pw);
    return { ok: "密码已修改，请用新密码重新登录" };
  } catch (e) {
    return fail(e);
  }
}

/* ---------- 主管理员设置员工的客户权限 ---------- */

const LEVELS = ["none", "view", "edit"] as const;
type Lv = (typeof LEVELS)[number];
const lv = (v: FormDataEntryValue | null): Lv | null => (LEVELS.includes(String(v) as Lv) ? (String(v) as Lv) : null);

/** 员工详情页：模式（全部客户 / 指定客户）+ 每个客户的权限 */
export async function setStaffAccessAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id"));
  try {
    const mode = fd.get("mode") === "all" ? "all" : "list";
    const customers: Record<string, Lv> = {};
    for (const [k, v] of fd.entries()) {
      const m = k.match(/^c\.(\d+)$/);
      const level = lv(v);
      if (m && level) customers[m[1]] = level;
    }
    setStaffAccess(id, { mode, customers });
    revalidatePath(`/staff/${id}`);
    revalidatePath("/staff");
    return { ok: "已保存客户权限" };
  } catch (e) {
    return fail(e);
  }
}

/** 客户详情页：这个客户哪些员工能看 / 能操作 */
export async function setCustomerStaffAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const customerId = Number(fd.get("customerId"));
  try {
    for (const s of listStaff()) {
      const level = lv(fd.get(`s.${s.id}`));
      if (!level) continue;
      const full = getStaff(s.id)!;
      const a = accessOf(full);
      setStaffAccess(s.id, { mode: a.mode, customers: { ...a.customers, [String(customerId)]: level } });
    }
    revalidatePath(`/customers/${customerId}`);
    revalidatePath("/staff");
    return { ok: "已保存员工权限" };
  } catch (e) {
    return fail(e);
  }
}

/* ---------- 主管理员：员工账号绑定销售（算提成） ---------- */

export async function bindStaffSalesAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const id = Number(fd.get("id"));
  const s = getStaff(id);
  if (!s) return { error: "员工不存在" };
  const raw = String(fd.get("salesId") ?? "");
  try {
    const { bindStaffSales } = await import("@/lib/commission");
    const rep = bindStaffSales(id, s.name, raw === "new" ? "new" : Number(raw) > 0 ? Number(raw) : null);
    revalidatePath(`/staff/${id}`);
    revalidatePath("/staff");
    return { ok: rep ? `已绑定销售“${rep.name}”：给客户绑定这个销售和比例后，员工在“我的看板”里能看到提成` : "已解除绑定" };
  } catch (e) {
    return fail(e);
  }
}
