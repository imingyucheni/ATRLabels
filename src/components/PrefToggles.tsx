"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLang, useT } from "./I18n";

type Theme = "auto" | "light" | "dark";

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

/** 深浅色 + 中英文切换（侧边栏底部、登录页） */
export default function PrefToggles({ showLang = true }: { showLang?: boolean }) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const [theme, setTheme] = useState<Theme>("auto");
  useEffect(() => {
    const v = document.documentElement.dataset.theme;
    setTheme(v === "light" || v === "dark" ? v : "auto");
  }, []);

  const pickTheme = (v: Theme) => {
    setTheme(v);
    setCookie("atr_theme", v);
    if (v === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = v;
  };
  const pickLang = (v: "zh" | "en") => {
    if (v === lang) return;
    setCookie("atr_lang", v);
    router.refresh();
  };

  const themes: [Theme, typeof Sun, string][] = [
    ["light", Sun, t("浅色")],
    ["dark", Moon, t("深色")],
    ["auto", Monitor, t("跟随系统")],
  ];
  const cur = themes.find(([v]) => v === theme) ?? themes[2];
  const CurIcon = cur[1];
  const nextTheme = () => pickTheme(theme === "light" ? "dark" : theme === "dark" ? "auto" : "light");
  return (
    <>
    <div className="prefs">
      <div className="seg" role="group" aria-label={t("外观")}>
        {themes.map(([v, Icon, label]) => (
          <button key={v} type="button" className={theme === v ? "on" : ""} aria-pressed={theme === v} title={label} onClick={() => pickTheme(v)}>
            <Icon size={14} strokeWidth={2} />
          </button>
        ))}
      </div>
      {showLang && (
        <div className="seg" role="group" aria-label={t("语言")}>
          <button type="button" className={lang === "zh" ? "on" : ""} aria-pressed={lang === "zh"} onClick={() => pickLang("zh")}>中文</button>
          <button type="button" className={lang === "en" ? "on" : ""} aria-pressed={lang === "en"} onClick={() => pickLang("en")}>EN</button>
        </div>
      )}
    </div>
    {/* 收起成图标菜单时：一个按钮轮换深浅色 + 竖排的 中/EN（CSS 控制只在图标菜单显示） */}
    <div className="prefs-mini">
      <button type="button" className="prefs-mini-theme" title={`${t("外观")}: ${cur[2]}`} aria-label={`${t("外观")}: ${cur[2]}`} onClick={nextTheme}>
        <CurIcon size={15} strokeWidth={2} />
      </button>
      {showLang && (
        <div className="seg vertical" role="group" aria-label={t("语言")}>
          <button type="button" className={lang === "zh" ? "on" : ""} aria-pressed={lang === "zh"} title="中文" onClick={() => pickLang("zh")}>中</button>
          <button type="button" className={lang === "en" ? "on" : ""} aria-pressed={lang === "en"} title="English" onClick={() => pickLang("en")}>EN</button>
        </div>
      )}
    </div>
    </>
  );
}
