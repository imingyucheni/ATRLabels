import { getSettings } from "@/lib/db";
import PortalLoginForm from "./PortalLoginForm";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return { title: getSettings().brandName };
}

export default function PortalLoginPage() {
  const { brandName, supportContact } = getSettings();
  return (
    <div className="login card">
      <h1>{brandName}</h1>
      <p className="muted" style={{ marginTop: -8 }}>客户登录</p>
      <PortalLoginForm />
      {supportContact && <p className="small muted" style={{ marginTop: 16 }}>开通账号或忘记密码请联系：{supportContact}</p>}
    </div>
  );
}
