import AuthShell from "@/components/AuthShell";
import LoginForm from "./LoginForm";
import { getT } from "@/lib/prefs";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("登录 · ATR 面单系统") };
}

export default async function LoginPage() {
  const t = await getT();
  return (
    <AuthShell
      brand="ATR Labels"
      headline={t("尾程面单，一处管理")}
      sub={t("报价、出单、补差、客户钱包与报表。")}
      points={["多渠道实时比价，按规则自动加价", "批量导入 ShipBest 导单表，一键合并打印", "官方账单补差自动对应到客户"].map((p) => t(p))}
    >
      <h1>{t("管理后台")}</h1>
      <p className="sub">{t("使用后台密码登录")}</p>
      <LoginForm />
    </AuthShell>
  );
}
