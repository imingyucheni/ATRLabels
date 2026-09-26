"use server";

import { headers } from "next/headers";
import { createLead } from "@/lib/leads";
import { getLang } from "@/lib/prefs";

type Values = Record<"company" | "contact" | "wechat" | "phone" | "email" | "volume" | "note", string>;
export type ApplyState = { ok?: boolean; error?: string; values?: Partial<Values> } | null;

const str = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max);

/** 官网“联系我们”表单（不需要登录；不会自动开户） */
export async function applyAction(_: ApplyState, fd: FormData): Promise<ApplyState> {
  const values: Values = {
    company: str(fd.get("company"), 80),
    contact: str(fd.get("contact"), 40),
    wechat: str(fd.get("wechat"), 40),
    phone: str(fd.get("phone"), 30),
    email: str(fd.get("email"), 80),
    volume: str(fd.get("volume"), 40),
    note: str(fd.get("note"), 500),
  };
  // 机器人会把隐藏的输入框也填上：假装成功，不保存
  if (str(fd.get("website"), 200)) return { ok: true };
  if (!values.company || !values.contact) return { error: "请填写公司 / 店铺名称和联系人", values };
  if (!values.wechat && !values.phone && !values.email) return { error: "微信、电话、邮箱至少填一个", values };
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return { error: "邮箱格式不对", values };
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  try {
    createLead({ ...values, wechat: values.wechat || null, phone: values.phone || null, email: values.email || null, volume: values.volume || null, note: values.note || null, lang: await getLang() }, ip);
  } catch (e) {
    return { error: (e as Error).message, values };
  }
  return { ok: true };
}
