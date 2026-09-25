import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { money } from "@/lib/pricing";
import { portalLogoutAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const me = await requireCustomer();
  const { brandName } = getSettings();
  return (
    <div className="shell">
      <nav className="nav portal">
        <div className="brand">{brandName}</div>
        <div className="who">{me.name}<div className="small">余额 <b>{money(me.balance)}</b></div></div>
        <Link href="/portal">首页</Link>
        <Link href="/portal/ship">＋ 下单</Link>
        <Link href="/portal/batch">批量下单</Link>
        <Link href="/portal/shipments">我的面单</Link>
        <Link href="/portal/billing">账户与账单</Link>
        <Link href="/portal/adjustments">补差明细</Link>
        <Link href="/portal/account">账户设置</Link>
        <div className="spacer" />
        <form action={portalLogoutAction}><button>退出登录</button></form>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
