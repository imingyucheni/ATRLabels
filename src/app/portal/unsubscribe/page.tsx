import Link from "next/link";
import { getSettings } from "@/lib/db";
import { getT } from "@/lib/prefs";
import { NOTIFY_LABEL, unsubscribe, type NotifyEvent } from "@/lib/notify";
import AuthShell from "@/components/AuthShell";

export const dynamic = "force-dynamic";

/** 邮件里的一键退订：不用登录，链接带签名 */
export default async function Unsubscribe({ searchParams }: { searchParams: Promise<{ c?: string; e?: string; s?: string }> }) {
  const sp = await searchParams;
  const t = await getT();
  const ok = unsubscribe(Number(sp.c), String(sp.e ?? ""), String(sp.s ?? ""));
  const label = NOTIFY_LABEL[sp.e as NotifyEvent];
  return (
    <AuthShell showLang brand={getSettings().brandName} headline={t("邮件通知")} sub="" points={[]}>
      {ok ? (
        <div className="alert ok">{t("已退订“{name}”邮件。以后可以在“账户设置 → 邮件通知”里重新打开。", { name: t(label) })}</div>
      ) : (
        <div className="alert err">{t("退订链接无效或已过期。可以登录后在“账户设置 → 邮件通知”里修改。")}</div>
      )}
      <Link className="btn" href="/portal/login">{t("登录")}</Link>
    </AuthShell>
  );
}
