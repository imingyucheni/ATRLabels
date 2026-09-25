import Link from "next/link";
import { getSettings } from "@/lib/db";
import AuthShell from "@/components/AuthShell";
import ForgotForm from "./Form";

export const dynamic = "force-dynamic";

export default function ForgotPage() {
  const { brandName, supportContact } = getSettings();
  return (
    <AuthShell showLang brand={brandName} headline="忘记密码" sub="输入登录邮箱，我们会帮你重置。" points={[]}>
      <h1>忘记密码</h1>
      <p className="sub">输入你的登录邮箱</p>
      <ForgotForm />
      <p className="small muted" style={{ marginTop: 18 }}>
        <Link href="/portal/login">← 返回登录</Link>{supportContact ? <> · 也可以直接联系：{supportContact}</> : null}
      </p>
    </AuthShell>
  );
}
