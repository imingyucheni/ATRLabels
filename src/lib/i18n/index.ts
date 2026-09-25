/**
 * 中英文切换：界面文字直接用中文写，英文版按中文原文查字典。
 * 没有翻译的文字原样显示中文，所以漏翻不会出错，只是那一句还是中文。
 * 字典按区域拆在 ./en/*.ts，这里合并。
 */
import { account } from "./en/account";
import { admin1 } from "./en/admin1";
import { admin1Patterns } from "./en/admin1Patterns";
import { admin2 } from "./en/admin2";
import { admin2Patterns } from "./en/admin2Patterns";
import { admin3 } from "./en/admin3";
import { admin3Patterns } from "./en/admin3Patterns";
import { common } from "./en/common";
import { fixA } from "./en/fixA";
import { fixB } from "./en/fixB";
import { fixC } from "./en/fixC";
import { orders } from "./en/orders";
import { orderPatterns } from "./en/orderPatterns";
import { patterns } from "./en/patterns";

export type Lang = "zh" | "en";
export type Vars = Record<string, string | number | null | undefined>;

const EN: Record<string, string> = { ...admin3, ...admin2, ...admin1, ...common, ...orders, ...account, ...fixA, ...fixB, ...fixC };
const PATTERNS: [RegExp, string][] = [...patterns, ...orderPatterns, ...admin1Patterns, ...admin2Patterns, ...admin3Patterns];

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
  for (const [re, rep] of PATTERNS) {
    if (re.test(msg)) return fragments(msg.replace(re, rep as string));
  }
  return fragments(msg);
}

/** ShipBest 错误码的中文说明会嵌在各种提示里（例如 “[11203] 该订单不支持取消（…）”），逐段替换成英文 */
const FRAGMENTS: [string, string][] = [
  ["ShipBest 系统维护升级中", "ShipBest is under maintenance"],
  ["物流产品不存在", "Service does not exist"],
  ["物流产品已停用", "Service is disabled"],
  ["包裹重量不在该渠道的下单重量范围内", "Package weight is outside this service's range"],
  ["运费试算失败", "Rate quote failed"],
  ["该物流产品没有设置价格，请联系 ShipBest", "No price set for this service; contact ShipBest"],
  ["自定义单号重复", "Duplicate order number"],
  ["API 授权信息无效（检查 apiId / accessToken）", "Invalid API credentials (check apiId / accessToken)"],
  ["请求频率超限，请稍后再试", "Too many requests, please try again later"],
  ["签名错误", "Signature error"],
  ["重复提交", "Duplicate submission"],
  ["时间戳无效（检查服务器时间）", "Invalid timestamp (check server time)"],
  ["OMS 账户余额不足，请先充值", "ShipBest account balance is too low"],
  ["OMS 账号已被停用", "ShipBest account is disabled"],
  ["订单在 ShipBest 系统中不存在", "Order not found in ShipBest"],
  ["该订单不支持取消", "This order can't be cancelled via API"],
  ["订单已取消，不能重复取消", "Order is already cancelled"],
  ["订单异常，不支持取消", "Order has an exception and can't be cancelled"],
  ["创建订单异常", "Order creation error"],
  ["不通邮", "not serviceable"],
];
function fragments(msg: string) {
  let out = msg;
  for (const [zh, en] of FRAGMENTS) if (out.includes(zh)) out = out.split(zh).join(en);
  return out.replace(/（/g, " (").replace(/）/g, ")");
}

export type T = (key: string, vars?: Vars) => string;
export const makeT = (lang: Lang): T => (key, vars) => translate(lang, key, vars);
