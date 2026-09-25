import { requireAdmin } from "@/lib/auth";
import { isMockMode } from "@/lib/shipbest/client";
import { pendingTopupCount } from "@/lib/topup";
import { pendingResets } from "@/lib/passwordReset";
import Sidebar from "@/components/Sidebar";
import fs from "node:fs";
import path from "node:path";
import { rateStats } from "@/lib/rates";

/** 当前运行的版本（GitHub 构建的发布包里有 VERSION 文件） */
function version() {
  try {
    return fs.readFileSync(path.join(process.cwd(), "VERSION"), "utf8").trim().slice(0, 7);
  } catch {
    return "";
  }
}
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
        brandSub={version() ? `管理后台 · 版本 ${version()}` : "管理后台"}
        envTag={
          isMockMode()
            ? Object.keys(rateStats()).length
              ? `模拟模式 · 按报价表计算（${Object.keys(rateStats()).length} 个渠道）`
              : "模拟模式 · 还没导入报价表，运费是粗略估算"
            : undefined
        }
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
            title: "美国本地面单",
            tag: "US",
            items: [
              { href: "/shipments", label: "面单记录", icon: "list" },
              { href: "/adjustments", label: "补差导入", icon: "adjust" },
              { href: "/coverage", label: "派送范围与价格", icon: "map" },
            ],
          },
          { title: "国际面单", soon: true, items: [{ href: "#intl", label: "国际下单", icon: "globe" }] },
          { title: "系统", items: [{ href: "/settings", label: "设置", icon: "settings" }] },
        ]}
      />
      <main className="main">{children}</main>
    </div>
  );
}
