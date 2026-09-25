/** 界面偏好（深浅色、语言）：存在浏览器 cookie 里，每个人自己选 */
import { cookies } from "next/headers";
import { makeT, translateMessage, type Lang } from "./i18n";

export type Theme = "auto" | "light" | "dark";
export const THEME_COOKIE = "atr_theme";
export const LANG_COOKIE = "atr_lang";

export async function getPrefs(): Promise<{ theme: Theme; lang: Lang }> {
  const c = await cookies();
  const theme = c.get(THEME_COOKIE)?.value;
  const lang = c.get(LANG_COOKIE)?.value;
  return {
    theme: theme === "light" || theme === "dark" ? theme : "auto",
    lang: lang === "en" ? "en" : "zh",
  };
}

/** 服务器组件里用：const t = await getT(); t("今日出单") */
export async function getT() {
  return makeT((await getPrefs()).lang);
}

export async function getLang() {
  return (await getPrefs()).lang;
}

/** 翻译要返回给客户的提示 */
export async function tMsg(msg: string | null | undefined) {
  return translateMessage(await getLang(), msg);
}
