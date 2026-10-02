"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18n";
import { SETTINGS_TABS, isSettingsTab, tabOfSection, type SettingsTab } from "@/lib/settingsTabs";

/**
 * 设置页的页签 + 当前页签里的小目录。
 * 每块设置都在页面里（隐藏的页签只是不显示，填了一半的表单不会丢）；切换页签只改地址栏 ?tab=，不重新加载。
 * 网址带 #某块（例如从别的页面点“去设置”）时自动切到那块所在的页签。
 */
export default function SettingsToc({ initial }: { initial: SettingsTab }) {
  const t = useT();
  const [tab, setTab] = useState<SettingsTab>(initial);
  const [present, setPresent] = useState<Set<string> | null>(null);

  const apply = (k: SettingsTab, push = false) => {
    setTab(k);
    const body = document.querySelector<HTMLElement>(".settings-body");
    if (body) body.dataset.settab = k;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", k);
    if (push) url.hash = "";
    window.history.replaceState(null, "", url);
  };

  // 左侧菜单点“服务商 / 渠道与价格”：同一页面换了 ?tab=，跟着切
  useEffect(() => {
    if (!window.location.hash) apply(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  useEffect(() => {
    setPresent(new Set(SETTINGS_TABS.flatMap((g) => g.sections.map(([id]) => id)).filter((id) => document.getElementById(id))));
    const byHash = () => {
      const id = window.location.hash.slice(1);
      if (id && document.getElementById(id)) apply(tabOfSection(id));
      else if (id === "pricing") apply("pricing");
    };
    byHash();
    const onPop = () => {
      const k = new URL(window.location.href).searchParams.get("tab");
      if (isSettingsTab(k)) apply(k);
    };
    window.addEventListener("hashchange", byHash);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("hashchange", byHash);
      window.removeEventListener("popstate", onPop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabs = SETTINGS_TABS.map((g) => ({ ...g, items: g.sections.filter(([id]) => !present || present.has(id)) })).filter((g) => g.items.length);
  const cur = tabs.find((g) => g.key === tab) ?? tabs[0];
  return (
    <>
      <nav className="tabs-bar settings-tabs" aria-label={t("设置分类")}>
        {tabs.map((g) => (
          <a key={g.key} href={`?tab=${g.key}`} className={g.key === tab ? "on" : ""} aria-current={g.key === tab ? "page" : undefined}
            onClick={(e) => { e.preventDefault(); apply(g.key, true); window.scrollTo({ top: 0 }); }}>
            {t(g.label)}
          </a>
        ))}
      </nav>
      {cur && cur.items.length > 1 && (
        <nav className="set-toc" aria-label={t("设置目录")}>
          <div className="set-toc-group">
            {cur.items.map(([id, label]) => <a key={id} href={`#${id}`}>{t(label)}</a>)}
          </div>
        </nav>
      )}
    </>
  );
}
