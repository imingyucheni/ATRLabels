import { getSettings } from "@/lib/db";
import AuthShell from "@/components/AuthShell";
import PortalLoginForm from "./PortalLoginForm";
import { getT } from "@/lib/prefs";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("登录")} · ${getSettings().brandName}` };
}

export default async function PortalLoginPage() {
  const { brandName, supportContact } = getSettings();
  const t = await getT();
  return (
    <AuthShell showLang
      brand={brandName}
      headline={t("美国尾程派送，下单更简单")}
      sub={t("实时比较多个渠道的运费，批量导单、打印 4×6 面单、查看账单。")}
      points={["多渠道运费一目了然，自动推荐最便宜", "Excel 批量导单，合并打印面单", "余额、扣款和补差明细随时可查"].map((p) => t(p))}
    >
      <h1>{t("客户登录")}</h1>
      <p className="sub">{t("使用我们为你开通的邮箱和密码登录")}</p>
      <PortalLoginForm />
      <p className="small muted" style={{ marginTop: 18 }}>
        <a href="/portal/forgot">{t("忘记密码？")}</a>
        {supportContact ? <> · {t("开通账号请联系：{contact}", { contact: supportContact })}</> : null}
      </p>
    </AuthShell>
  );
}
