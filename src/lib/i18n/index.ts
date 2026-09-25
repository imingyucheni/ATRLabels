/**
 * 中英文切换：界面文字直接用中文写，英文版按中文原文查字典。
 * 没有翻译的文字原样显示中文，所以漏翻不会出错，只是那一句还是中文。
 * 字典按区域拆在 ./en/*.ts，这里合并。
 */
import { account } from "./en/account";
import { common } from "./en/common";
import { orders } from "./en/orders";
import { patterns } from "./en/patterns";

export type Lang = "zh" | "en";
export type Vars = Record<string, string | number | null | undefined>;

const EN: Record<string, string> = { ...common, ...orders, ...account };

function fill(s: string, vars?: Vars) {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : s;
}

/** t("约够用 {n} 天", { n: 3 }) */
export function translate(lang: Lang, key: string, vars?: Vars): string {
  if (lang !== "en" || !key) return fill(key, vars);
  const hit = EN[key];
  if (hit !== undefined) return fill(hit, vars);
  return fill(key, vars);
}

/** 翻译服务器返回的整句提示（可能带单号、金额等变量）：先查字典，再按规则替换 */
export function translateMessage(lang: Lang, msg: string | null | undefined): string {
  if (!msg) return msg ?? "";
  if (lang !== "en") return msg;
  if (EN[msg] !== undefined) return EN[msg];
  for (const [re, rep] of patterns) {
    if (re.test(msg)) return msg.replace(re, rep as string);
  }
  return msg;
}

export type T = (key: string, vars?: Vars) => string;
export const makeT = (lang: Lang): T => (key, vars) => translate(lang, key, vars);
