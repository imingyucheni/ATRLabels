"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useT } from "@/components/I18n";

const TOGGLE_ALL = "settings:toggle-all";

/**
 * 设置页的一块：已经设置好的默认收起，标题行显示当前状态；需要处理的默认展开。
 * 收起时内容只是隐藏（不卸载），填了一半的表单和保存提示不会丢。
 * 网址带 #id（例如从别的页面点“去设置”过来）时自动展开并滚动到这里。
 */
export default function SettingsSection({ id, title, badge, summary, actions, defaultOpen = false, className = "", children }: {
  id: string;
  title: string;
  badge?: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const t = useT();

  useEffect(() => {
    const byHash = () => {
      if (window.location.hash === `#${id}`) {
        setOpen(true);
        requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
      }
    };
    const all = (e: Event) => setOpen((e as CustomEvent<boolean>).detail);
    byHash();
    window.addEventListener("hashchange", byHash);
    window.addEventListener(TOGGLE_ALL, all);
    return () => {
      window.removeEventListener("hashchange", byHash);
      window.removeEventListener(TOGGLE_ALL, all);
    };
  }, [id]);

  return (
    <section className={`card set-sec${open ? " open" : ""} ${className}`} id={id}>
      <div className="set-sec-head">
        <button type="button" className="set-sec-toggle" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen((o) => !o)}>
          <ChevronDown size={18} className="set-sec-chev" aria-hidden="true" />
          <h2>{title}</h2>
          {badge}
          {!open && summary && <span className="set-sec-sum small muted">{summary}</span>}
          <span className="set-sec-hint small muted">{open ? t("收起") : t("展开")}</span>
        </button>
        {actions && <div className="set-sec-actions">{actions}</div>}
      </div>
      <div id={`${id}-body`} className="set-sec-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** 全部展开 / 全部收起 */
export function SettingsToggleAll() {
  const t = useT();
  const fire = (v: boolean) => window.dispatchEvent(new CustomEvent(TOGGLE_ALL, { detail: v }));
  return (
    <div className="row" style={{ gap: 8 }}>
      <button type="button" className="small" onClick={() => fire(true)}>{t("全部展开")}</button>
      <button type="button" className="small" onClick={() => fire(false)}>{t("全部收起")}</button>
    </div>
  );
}
