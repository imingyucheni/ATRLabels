"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, CreditCard, FileSpreadsheet, FileText, LayoutDashboard, LogOut, PackagePlus, Receipt, Scale, Settings,
  Truck, Upload, UserCog, Users, Wallet,
} from "lucide-react";

const ICONS = {
  dashboard: LayoutDashboard, ship: PackagePlus, batch: Upload, list: Truck, reports: BarChart3, adjust: Scale,
  customers: Users, finance: Wallet, settings: Settings, topup: CreditCard, billing: Receipt, sheet: FileSpreadsheet,
  account: UserCog, doc: FileText,
};

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; count?: number; exact?: boolean };
export type NavGroup = { title?: string; items: NavItem[] };

export default function Sidebar(props: {
  brand: string;
  brandSub: string;
  groups: NavGroup[];
  who?: { name: string; balance?: string; negative?: boolean };
  envTag?: string;
  logout: () => Promise<void>;
}) {
  const path = usePathname();
  // 选中“最长匹配”的菜单，避免 /shipments 和 /shipments/new 同时高亮
  const all = props.groups.flatMap((g) => g.items);
  const match = (i: NavItem) => (i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/"));
  const active = all.filter(match).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const initials = props.brand.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || props.brand.slice(0, 2);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">{initials}</div>
        <div>
          <div className="brand-name">{props.brand}</div>
          <div className="brand-sub">{props.brandSub}</div>
        </div>
      </div>
      {props.groups.map((g, gi) => (
        <nav key={gi} aria-label={g.title}>
          {g.title && <div className="nav-section">{g.title}</div>}
          {g.items.map((i) => {
            const Icon = ICONS[i.icon];
            return (
              <Link key={i.href} href={i.href} className={`nav-item ${active === i.href ? "active" : ""}`} aria-current={active === i.href ? "page" : undefined}>
                <Icon strokeWidth={1.9} />
                {i.label}
                {!!i.count && <span className="nav-count">{i.count}</span>}
              </Link>
            );
          })}
        </nav>
      ))}
      <div className="sidebar-foot">
        {props.envTag && <div className="env-tag">{props.envTag}</div>}
        {props.who && (
          <div className="who-card">
            <div className="name">{props.who.name}</div>
            {props.who.balance && <div className="bal">余额 <b className={props.who.negative ? "neg" : ""}>{props.who.balance}</b></div>}
          </div>
        )}
        <form action={props.logout}>
          <button className="logout small"><LogOut size={14} strokeWidth={2} /> 退出登录</button>
        </form>
      </div>
    </aside>
  );
}
