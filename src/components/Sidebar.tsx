"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import PrefToggles from "./PrefToggles";
import { useT } from "./I18n";
import {
  BarChart3, Globe2, Lock, Map as MapIcon, Menu, X, CreditCard, FileSpreadsheet, FileText, LayoutDashboard, LogOut, PackagePlus, Receipt, Scale, Settings,
  Truck, Upload, UserCog, Users, Wallet,
} from "lucide-react";

const ICONS = {
  dashboard: LayoutDashboard, ship: PackagePlus, batch: Upload, list: Truck, reports: BarChart3, adjust: Scale,
  customers: Users, finance: Wallet, settings: Settings, topup: CreditCard, billing: Receipt, sheet: FileSpreadsheet,
  account: UserCog, doc: FileText, map: MapIcon, globe: Globe2,
};

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; count?: number; exact?: boolean; soon?: boolean };
export type NavGroup = { title?: string; tag?: string; soon?: boolean; items: NavItem[] };

export default function Sidebar(props: {
  brand: string;
  brandSub: string;
  groups: NavGroup[];
  who?: { name: string; balance?: string; negative?: boolean };
  envTag?: string;
  logout: () => Promise<void>;
  /** 显示中英文切换（目前只有客户端有英文版） */
  showLang?: boolean;
}) {
  const t = useT();
  const path = usePathname();
  // 选中“最长匹配”的菜单，避免 /shipments 和 /shipments/new 同时高亮
  const all = props.groups.flatMap((g) => g.items);
  const match = (i: NavItem) => (i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/"));
  const active = all.filter(match).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const initials = props.brand.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || props.brand.slice(0, 2);
  // 手机上菜单默认收起，点右上角按钮展开；切换页面后自动收起
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const current = all.find((i) => i.href === active);

  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="brand">
        <div className="brand-mark">{initials}</div>
        <div>
          <div className="brand-name">{props.brand}</div>
          <div className="brand-sub">{t(props.brandSub)}</div>
        </div>
        {current && <span className="mobile-current">{t(current.label)}</span>}
        <button type="button" className="menu-toggle" aria-label={open ? t("收起菜单") : t("展开菜单")} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? <X size={18} /> : <Menu size={18} />}
          {!open && all.some((i) => i.count) && <span className="menu-dot" />}
        </button>
      </div>
      {props.groups.map((g, gi) => (
        <nav key={gi} aria-label={g.title && t(g.title)}>
          {g.title && (
            <div className={`nav-section${g.soon ? " soon" : ""}`}>
              {t(g.title)}
              {g.tag && <span className="nav-tag">{g.tag}</span>}
            </div>
          )}
          {g.items.map((i) => {
            const Icon = ICONS[i.icon];
            // 还没开放的功能：灰显，点不开
            if (i.soon || g.soon)
              return (
                <span key={i.href} className="nav-item disabled" aria-disabled="true" title={t("敬请期待")}>
                  <Icon strokeWidth={1.9} />
                  {t(i.label)}
                  <span className="nav-soon"><Lock size={10} strokeWidth={2.4} /> {t("敬请期待")}</span>
                </span>
              );
            return (
              <Link key={i.href} href={i.href} className={`nav-item ${active === i.href ? "active" : ""}`} aria-current={active === i.href ? "page" : undefined}>
                <Icon strokeWidth={1.9} />
                {t(i.label)}
                {!!i.count && <span className="nav-count">{i.count}</span>}
              </Link>
            );
          })}
        </nav>
      ))}
      <div className="sidebar-foot">
        <PrefToggles showLang={props.showLang} />
        {props.envTag && <div className="env-tag">{props.envTag}</div>}
        {props.who && (
          <div className="who-card">
            <div className="name">{props.who.name}</div>
            {props.who.balance && <div className="bal">{t("余额")} <b className={props.who.negative ? "neg" : ""}>{props.who.balance}</b></div>}
          </div>
        )}
        <form action={props.logout}>
          <button className="logout small"><LogOut size={14} strokeWidth={2} /> {t("退出登录")}</button>
        </form>
      </div>
    </aside>
  );
}
