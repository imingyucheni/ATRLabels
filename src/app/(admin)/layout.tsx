import { requireAdmin } from "@/lib/auth";
import { isMockMode } from "@/lib/shipbest/client";
import { pendingTopupCount } from "@/lib/topup";
import { pendingResets } from "@/lib/passwordReset";
import Sidebar from "@/components/Sidebar";
import { logoutAction } from "../actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "ATR 面单系统 · 后台" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const pendingTopups = pendingTopupCount();
  const resets = pendingResets().length;
  return (
    <div className="shell">
      <Sidebar
        brand="ATR Labels"
        brandSub="管理后台"
        envTag={isMockMode() ? "模拟模式 · 未连接真实 ShipBest" : undefined}
        logout={logoutAction}
        groups={[
          { items: [{ href: "/", label: "概览", icon: "dashboard", exact: true }, { href: "/reports", label: "报表", icon: "reports" }] },
          {
            title: "客户",
            items: [
              { href: "/customers", label: "客户管理", icon: "customers", count: resets },
              { href: "/quote", label: "运费试算", icon: "ship" },
              { href: "/finance", label: "财务 · 充值审核", icon: "finance", count: pendingTopups },
            ],
          },
          {
            title: "订单",
            items: [
              { href: "/shipments", label: "面单记录", icon: "list" },
              { href: "/adjustments", label: "补差导入", icon: "adjust" },
            ],
          },
          { title: "系统", items: [{ href: "/coverage", label: "派送范围", icon: "map" }, { href: "/settings", label: "设置", icon: "settings" }] },
        ]}
      />
      <main className="main">{children}</main>
    </div>
  );
}
