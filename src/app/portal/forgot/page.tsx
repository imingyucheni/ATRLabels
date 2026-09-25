import Link from "next/link";
import { getSettings } from "@/lib/db";
import AuthShell from "@/components/AuthShell";
import ForgotForm from "./Form";
import { getT } from "@/lib/prefs";

export const dynamic = "force-dynamic";

export default async function ForgotPage() {
  const { brandName, supportContact } = getSettings();
  const t = await getT();
  return (
    <AuthShell showLang brand={brandName} headline={t("忘记密码")} sub={t("输入登录邮箱，我们会帮你重置。")} points={[]}>
      <h1>{t("忘记密码")}</h1>
      <p className="sub">{t("输入你的登录邮箱")}</p>
      <ForgotForm />
      <p className="small muted" style={{ marginTop: 18 }}>
        <Link href="/portal/login">← {t("返回登录")}</Link>{supportContact ? <> · {t("也可以直接联系：{contact}", { contact: supportContact })}</> : null}
      </p>
    </AuthShell>
  );
}
