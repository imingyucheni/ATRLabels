import { requireAdmin } from "@/lib/auth";
import { customerFilter } from "@/lib/adminSession";
import { listTopups } from "@/lib/topup";
import { isSandboxSite, shipbestMode } from "@/lib/shipbest/client";
import { siteSwitch } from "@/lib/sites";
import { currentEnv } from "@/lib/db";
import { dhlSettings } from "@/lib/shipbest/dhl";
import { pendingTopupCount } from "@/lib/topup";
import { pendingResets } from "@/lib/passwordReset";
import { newLeadCount } from "@/lib/leads";
import Sidebar from "@/components/Sidebar";
import fs from "node:fs";
import path from "node:path";
import { rateStats } from "@/lib/rates";
import { getT } from "@/lib/prefs";

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

export async function generateMetadata() {
  const t = await getT();
  return { title: t("ATRShip · 后台") };
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // 员工（二级管理员）也能进后台，但只能开部分页面（proxy 里拦），菜单也只显示这些
  const who = await requireAdmin({ staff: true });
  const staff = who.role === "staff";
  // 员工的待办数字只算授权给他的客户
  const canSee = customerFilter(who);
  const pendingTopups = who.role === "staff" ? listTopups({ status: "pending" }).filter((t) => canSee(t.customerId)).length : pendingTopupCount();
  const resets = pendingResets().filter((r) => canSee(r.customer_id)).length;
  const leads = newLeadCount();
  const t = await getT();
  return (
    <div className="shell">
      <Sidebar
        brand="ATRShip"
        brandSub={staff ? t("员工：{name}", { name: who.name }) : version() ? t("管理后台 · 版本 {v}", { v: version() }) : "管理后台"}
        siteLink={(() => {
          const sw = siteSwitch();
          return sw ? { href: sw.url, label: sw.toSandbox ? t("切换到沙盒站") : t("切换到正式站") } : undefined;
        })()}
        envTag={
          shipbestMode() === "sandbox"
            ? t("沙盒模式 · 真实报价，模拟出单（不扣费）")
            : shipbestMode() === "mock"
            ? Object.keys(rateStats()).length
              ? t("模拟模式 · 按报价表计算（{n} 个渠道）", { n: Object.keys(rateStats()).length })
              : t("模拟模式 · 还没导入报价表，运费是粗略估算")
            : undefined
        }
        logout={logoutAction}
        groups={staff ? [
          {
            title: "客户",
            items: [
              { href: "/customers", label: "客户管理", icon: "customers", count: resets },
              { href: "/leads", label: "客户咨询", icon: "leads", count: leads },
              { href: "/quote", label: "运费试算", icon: "ship" },
              { href: "/finance", label: "财务 · 充值审核", icon: "finance", count: pendingTopups },
            ],
          },
          { title: "我的账号", items: [{ href: "/account", label: "我的账号 · 确认密码", icon: "account" }] },
        ] : [
          { items: [{ href: "/", label: "概览", icon: "dashboard", exact: true }, { href: "/reports", label: "报表", icon: "reports" }, { href: "/reconcile", label: "服务商对账", icon: "billing" }] },
          // 面单：美国本地 / 国际下单、面单记录、补差都在这里
          {
            title: "面单",
            items: [
              { href: "/ship", label: "管理员下单", icon: "ship", exact: true },
              { href: "/ship/batch", label: "管理员批量下单", icon: "batch" },
              { href: "/ship/multi", label: "多箱寄出", icon: "boxes" },
              dhlSettings().enabled
                ? { href: "/ship/intl", label: "国际下单（DHL）", icon: "globe" }
                : { href: "/ship/intl", label: "国际下单（DHL）", icon: "globe", soon: true },
              { href: "/shipments", label: "面单记录", icon: "list" },
              { href: "/adjustments", label: "补差导入", icon: "adjust" },
              { href: "/coverage", label: "派送范围与价格", icon: "map" },
            ],
          },
          {
            title: "客户",
            items: [
              { href: "/customers", label: "客户管理", icon: "customers", count: resets },
              { href: "/leads", label: "客户咨询", icon: "leads", count: leads },
              { href: "/quote", label: "运费试算", icon: "calc" },
              { href: "/finance", label: "财务 · 充值审核", icon: "finance", count: pendingTopups },
              { href: "/commissions", label: "销售佣金", icon: "commission" },
            ],
          },
          // 设置：服务商（ShipBest / 嘉谷 / ShipGrid / DHL）和渠道价格单独有入口，其他在“更多设置”的页签里
          {
            title: "设置",
            items: [
              { href: "/settings?tab=providers", label: "服务商", icon: "provider" },
              { href: "/settings?tab=pricing", label: "渠道与价格", icon: "price" },
              { href: "/settings?tab=customers", label: "更多设置", icon: "settings" },
              { href: "/staff", label: "员工账号", icon: "account" },
              { href: "/backups", label: "数据备份", icon: "backup" },
            ],
          },
        ]}
      />
      <main className="main">
        {isSandboxSite() && <div className="site-ribbon">{t("沙盒站 · 测试专用，数据和正式站分开，不会真实出单")}</div>}
        {!isSandboxSite() && currentEnv() === "test" && (
          <div className="site-ribbon">{t("测试环境 · 这里的订单、充值、余额都是测试数据，和正式数据完全分开；切回“正式”模式就是真实数据")}</div>
        )}
        {children}
      </main>
    </div>
  );
}
