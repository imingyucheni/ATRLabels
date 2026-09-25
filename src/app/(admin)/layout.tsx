import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { isMockMode } from "@/lib/shipbest/client";
import { logoutAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">ATR 面单系统</div>
        <Link href="/">概览</Link>
        <Link href="/shipments/new">＋ 新建面单</Link>
        <Link href="/shipments">面单记录</Link>
        <Link href="/adjustments">补差导入</Link>
        <Link href="/customers">客户</Link>
        <Link href="/settings">设置</Link>
        <div className="spacer" />
        {isMockMode() && <div className="mock">模拟模式：未连接真实 ShipBest</div>}
        <form action={logoutAction}>
          <button>退出登录</button>
        </form>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
