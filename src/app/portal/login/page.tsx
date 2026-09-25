import { getSettings } from "@/lib/db";
import AuthShell from "@/components/AuthShell";
import PortalLoginForm from "./PortalLoginForm";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return { title: `登录 · ${getSettings().brandName}` };
}

export default function PortalLoginPage() {
  const { brandName, supportContact } = getSettings();
  return (
    <AuthShell
      brand={brandName}
      headline="美国尾程派送，下单更简单"
      sub="实时比较多个渠道的运费，批量导单、打印 4×6 面单、查看账单。"
      points={["多渠道运费一目了然，自动推荐最便宜", "Excel 批量导单，合并打印面单", "余额、扣款和补差明细随时可查"]}
    >
      <h1>客户登录</h1>
      <p className="sub">使用我们为你开通的邮箱和密码登录</p>
      <PortalLoginForm />
      <p className="small muted" style={{ marginTop: 18 }}>
        <a href="/portal/forgot">忘记密码？</a>
        {supportContact ? <> · 开通账号请联系：{supportContact}</> : null}
      </p>
    </AuthShell>
  );
}
