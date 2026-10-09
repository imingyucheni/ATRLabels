import { impersonatedCustomerId, requireCustomer } from "@/lib/auth";
import { isSandboxSite, shipbestMode } from "@/lib/shipbest/client";
import { customerChannels, getSettings } from "@/lib/db";
import { redirect } from "next/navigation";
import { hasAcceptedTerms } from "@/lib/terms";
import { money, usd } from "@/lib/pricing";
import Sidebar from "@/components/Sidebar";
import { listDraftRows } from "@/lib/batch";
import { customerChannelMap } from "@/lib/channelDisplay";
import { portalChannelCodes } from "@/lib/portal";
import { isDhlCode } from "@/lib/shipbest/dhl";
import { listStores, storesEnabled } from "@/lib/stores";
import { apiEnabled } from "@/lib/api/keys";
import { ChannelNamesProvider } from "@/components/ChannelLabel";
import { getT } from "@/lib/prefs";
import { leaveCustomerAction, portalLogoutAction } from "../actions";
import { isMultiBoxName } from "@/lib/multiBox";
import { multiEnabled } from "@/lib/multiAccess";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return { title: getSettings().brandName };
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const me = await requireCustomer();
  const { brandName } = getSettings();
  // 角标只数能直接提交的（已试算成功）；出错 / 失败 / 还在试算的不算
  const drafts = listDraftRows(me.id).filter((r) => r.status === "quoted").length;
  const storesOn = storesEnabled(me.id);
  const multiOn = multiEnabled(me.id) && customerChannels(me.id).some((c) => isMultiBoxName(c.name));
  const storeOpen = storesOn ? listStores(me.id).reduce((n, s) => n + s.openCount, 0) : 0;
  const acting = !!(await impersonatedCustomerId());
  // 还没同意（当前版本的）服务条款：先去同意；管理员代操作不拦
  if (!acting && !hasAcceptedTerms(me.id)) redirect("/portal/terms");
  const t = await getT();
  return (
    <ChannelNamesProvider map={customerChannelMap(portalChannelCodes(me.id))}>
    <div className="shell">
      <Sidebar
        brand={brandName}
        brandSub="客户中心"
        showLang
        logout={portalLogoutAction}
        who={{ name: me.name, balance: usd(me.balance), negative: me.balance < 0 }}
        groups={[
          { items: [{ href: "/portal", label: "首页", icon: "dashboard", exact: true }] },
          {
            title: "美国本地面单",
            tag: "US",
            items: [
              { href: "/portal/ship", label: "单个下单", icon: "ship" },
              { href: "/portal/batch", label: "批量导入", icon: "batch" },
              // 开通了多箱渠道（UPS HWT / FedEx MWT）的客户才显示
              ...(multiOn ? [{ href: "/portal/multi", label: "多箱寄出", icon: "boxes" as const }] : []),
              // 店铺对接测试阶段：后台开放了的客户才显示
              ...(storesOn ? [{ href: "/portal/stores", label: "店铺订单", icon: "store" as const, count: storeOpen }] : []),
              { href: "/portal/drafts", label: "待出单", icon: "sheet", count: drafts },
              { href: "/portal/shipments", label: "我的面单", icon: "list" },
              { href: "/portal/products", label: "常用产品", icon: "product" },
            ],
          },
          // 开通了 DHL 渠道的客户才能国际下单
          portalChannelCodes(me.id).some(isDhlCode)
            ? { title: "国际面单", items: [{ href: "/portal/intl", label: "国际下单", icon: "globe" }] }
            : { title: "国际面单", soon: true, items: [{ href: "#intl", label: "国际下单", icon: "globe" }] },
          {
            title: "账户",
            items: [
              { href: "/portal/topup", label: "充值", icon: "topup" },
              { href: "/portal/billing", label: "账单与扣款", icon: "billing" },
              { href: "/portal/adjustments", label: "补差明细", icon: "adjust" },
              { href: "/portal/account", label: "账户设置", icon: "account" },
              // 开放 API 测试阶段：后台开通了的客户才显示
              ...(apiEnabled(me.id) ? [{ href: "/portal/api", label: "API 对接", icon: "code" as const }] : []),
            ],
          },
        ]}
      />
      <main className="main">
        {isSandboxSite() && <div className="site-ribbon">{t("沙盒站 · 测试专用，数据和正式站分开，不会真实出单")}</div>}
        {shipbestMode() === "mock" && <div className="acting-bar">{t("演示模式：运费是按报价表模拟的，面单也是模拟的，不会真实出单。")}</div>}
        {me.testAccount && shipbestMode() === "live" && <div className="acting-bar">{t("内部测试账号：运费是实时报价，面单是模拟的，不会真实出单扣费。")}</div>}
        {shipbestMode() === "sandbox" && <div className="acting-bar">{t("测试模式：运费是实时报价，面单是模拟的，不会真实出单扣费。")}</div>}
        {acting && (
          <form action={leaveCustomerAction} className="acting-bar">
            <span>{t("管理员正在以")} <b>{me.name}</b> {t("的身份操作这个客户的 OMS，下单、充值等记录会标记为管理员代操作。")}</span>
            <button className="small">{t("退出代操作，返回后台")}</button>
          </form>
        )}
        {children}
      </main>
    </div>
    </ChannelNamesProvider>
  );
}
