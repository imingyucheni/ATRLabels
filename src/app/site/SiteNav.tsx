"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import PrefToggles from "@/components/PrefToggles";
import { useT } from "@/components/I18n";

/** 官网顶栏：品牌、锚点、登录 / 申请开户、深浅色和语言 */
export default function SiteNav({ brand, home = true }: { brand: string; home?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const initials = brand.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || brand.slice(0, 2);
  const anchor = (id: string) => (home ? `#${id}` : `/site#${id}`);
  const links = [
    { href: anchor("why"), label: t("优势") },
    { href: anchor("how"), label: t("流程") },
    { href: anchor("faq"), label: t("常见问题") },
  ];
  return (
    <nav className={`site-nav${open ? " open" : ""}`}>
      <div className="site-wrap site-nav-in">
        <Link href="/site" className="site-brand" onClick={() => setOpen(false)}>
          <span className="brand-mark">{initials}</span>
          <span>{brand}</span>
        </Link>
        <div className="site-links">
          {links.map((l) => <a key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</a>)}
        </div>
        <div className="site-nav-right">
          <PrefToggles />
          <Link href="/portal" className="site-nav-login">{t("登录")}</Link>
          <Link href="/site/apply" className="btn us-btn">{t("免费开户")}</Link>
        </div>
        <button type="button" className="site-burger" aria-label={t("菜单")} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
    </nav>
  );
}
