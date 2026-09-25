"use client";

import { createContext, useContext } from "react";
import { makeT, translateMessage, type Lang } from "@/lib/i18n";

const Ctx = createContext<Lang>("zh");

export function I18nProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <Ctx.Provider value={lang}>{children}</Ctx.Provider>;
}

export function useLang() {
  return useContext(Ctx);
}

/** 客户端组件里用：const t = useT(); t("下单") */
export function useT() {
  return makeT(useContext(Ctx));
}

export function useTMsg() {
  const lang = useContext(Ctx);
  return (m: string | null | undefined) => translateMessage(lang, m);
}
