import { requireCustomer } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { money, usd } from "@/lib/pricing";
import Sidebar from "@/components/Sidebar";
import { listDraftRows } from "@/lib/batch";
import { portalLogoutAction } from "../actions";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return { title: getSettings().brandName };
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const me = await requireCustomer();
  const { brandName } = getSettings();
  const drafts = listDraftRows(me.id).length;
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
            title: "下单",
            items: [
              { href: "/portal/ship", label: "单个下单", icon: "ship" },
              { href: "/portal/batch", label: "批量导入", icon: "batch" },
              { href: "/portal/drafts", label: "待出单", icon: "sheet", count: drafts },
              { href: "/portal/shipments", label: "我的面单", icon: "list" },
            ],
          },
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
      <main className="main">{children}</main>
    </div>
  );
}
