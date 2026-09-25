import { impersonatedCustomerId, requireCustomer } from "@/lib/auth";
import { isMockMode } from "@/lib/shipbest/client";
import { getSettings } from "@/lib/db";
import { money, usd } from "@/lib/pricing";
import Sidebar from "@/components/Sidebar";
import { listDraftRows } from "@/lib/batch";
import { leaveCustomerAction, portalLogoutAction } from "../actions";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return { title: getSettings().brandName };
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const me = await requireCustomer();
  const { brandName } = getSettings();
  const drafts = listDraftRows(me.id).length;
  const acting = !!(await impersonatedCustomerId());
  return (
    <div className="shell">
      <Sidebar
        brand={brandName}
        brandSub="客户中心"
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
              { href: "/portal/drafts", label: "待出单", icon: "sheet", count: drafts },
              { href: "/portal/shipments", label: "我的面单", icon: "list" },
            ],
          },
          { title: "国际面单", soon: true, items: [{ href: "#intl", label: "国际下单", icon: "globe" }] },
          {
            title: "账户",
            items: [
              { href: "/portal/topup", label: "充值", icon: "topup" },
              { href: "/portal/billing", label: "账单与扣款", icon: "billing" },
              { href: "/portal/adjustments", label: "补差明细", icon: "adjust" },
              { href: "/portal/account", label: "账户设置", icon: "account" },
            ],
          },
        ]}
      />
      <main className="main">
        {isMockMode() && <div className="acting-bar">演示模式：运费是按报价表模拟的，面单也是模拟的，不会真实出单。</div>}
        {acting && (
          <form action={leaveCustomerAction} className="acting-bar">
            <span>管理员正在以 <b>{me.name}</b> 的身份操作这个客户的 OMS，下单、充值等记录会标记为管理员代操作。</span>
            <button className="small">退出代操作，返回后台</button>
          </form>
        )}
        {children}
      </main>
    </div>
  );
}
