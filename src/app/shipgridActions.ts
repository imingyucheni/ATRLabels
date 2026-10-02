"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getSettings, saveSettings } from "@/lib/db";
import { getT } from "@/lib/prefs";
import { str } from "@/lib/sanitize";
import { sgKeyMode, shipgridSettings, shipgridStatus } from "@/lib/shipbest/shipgrid";
import type { FlashState } from "@/app/actions";

/** 保存 ShipGrid 密钥（留空 = 不修改）并测试连接 */
export async function saveShipGridAction(_: FlashState, fd: FormData): Promise<FlashState> {
  await requireAdmin();
  const t = await getT();
  const cur = shipgridSettings();
  const raw = str(fd.get("apiKey"), 200).replace(/\s+/g, "");
  if (raw && !sgKeyMode(raw)) return { error: t("密钥格式不对：应该以 ak_test_ 或 ak_live_ 开头") };
  const next = { enabled: fd.get("enabled") === "1", apiKey: raw || cur.apiKey };
  if (next.enabled && !next.apiKey) return { error: t("启用前请填写 ShipGrid 密钥") };
  saveSettings({ shipgrid: next });
  revalidatePath("/settings");
  if (!next.apiKey) return { ok: t("已保存") };
  return status(t("已保存"));
}

export async function testShipGridAction(_: FlashState): Promise<FlashState> {
  await requireAdmin();
  return status((await getT())("连接成功"));
}

async function status(prefix: string): Promise<FlashState> {
  const t = await getT();
  const key = getSettings().shipgrid?.apiKey ?? "";
  if (!key) return { error: t("还没有填写 ShipGrid 密钥") };
  try {
    const s = await shipgridStatus(key);
    const keyMode = sgKeyMode(key);
    const bal = s.account.balance;
    const parts = [
      `${prefix}：${s.account.organization?.name ?? s.account.name}`,
      keyMode === "test" ? t("测试密钥") : t("正式密钥"),
      bal ? t("钱包 ${a}（SG 赠送额度 ${b}）", { a: bal.available.toFixed(2), b: (bal.partner_funded ?? 0).toFixed(2) }) : "",
      t("物流商：{list}", { list: s.carriers.filter((c) => c.is_active).map((c) => c.carrier).join("、") || "-" }),
      s.rates.ok ? t("查价正常（示例包裹返回 {n} 个价格）", { n: s.rates.count }) : t("查价不可用：{msg}（{code}）", { msg: s.rates.message, code: s.rates.code }),
    ].filter(Boolean);
    const warns: string[] = [];
    if (!s.rates.ok && s.rates.code === "PLAN_UPGRADE_REQUIRED") warns.push(t("SG 账户的套餐还没开通 API 查价 / 出单，请联系 SG（support@shipgrid.ai）开通"));
    if (keyMode === "test" && s.mode && s.mode !== "test") warns.push(t("注意：测试密钥但 SG 返回的环境是 {m}，确认前不要用它出单", { m: s.mode }));
    const msg = [parts.join(" · "), ...warns].join("\n");
    return s.rates.ok && !warns.length ? { ok: msg } : { error: msg };
  } catch (e) {
    return { error: t("连接失败：{msg}", { msg: (e as Error).message }) };
  }
}
