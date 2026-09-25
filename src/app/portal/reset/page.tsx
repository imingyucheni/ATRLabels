import Link from "next/link";
import { getSettings } from "@/lib/db";
import { checkToken } from "@/lib/passwordReset";
import AuthShell from "@/components/AuthShell";
import ResetForm from "./Form";

export const dynamic = "force-dynamic";

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const valid = token && checkToken(token);
  return (
    <AuthShell showLang brand={getSettings().brandName} headline="设置新密码" sub="设置后会自动登录。" points={[]}>
      <h1>设置新密码</h1>
      {valid ? <ResetForm token={token} /> : <div className="alert err">链接无效或已过期，请 <Link href="/portal/forgot">重新申请</Link>。</div>}
    </AuthShell>
  );
}
