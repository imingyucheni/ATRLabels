import AuthShell from "@/components/AuthShell";
import LoginForm from "./LoginForm";

export const metadata = { title: "登录 · ATR 面单系统" };

export default function LoginPage() {
  return (
    <AuthShell
      brand="ATR Labels"
      headline="尾程面单，一处管理"
      sub="报价、出单、补差、客户钱包与报表。"
      points={["多渠道实时比价，按规则自动加价", "批量导入 ShipBest 导单表，一键合并打印", "官方账单补差自动对应到客户"]}
    >
      <h1>管理后台</h1>
      <p className="sub">使用后台密码登录</p>
      <LoginForm />
    </AuthShell>
  );
}
