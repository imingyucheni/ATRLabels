/**
 * 收件地址核对（USPS Addresses API v3）：下单前检查地址是否存在、是否缺公寓号，并给出标准写法。
 * - 在后台“设置 → 地址核对”填写 USPS 开发者账号的 Consumer Key / Secret 后启用。
 * - 结果永久保存，同一个地址只查一次（USPS 默认每小时 60 次额度）。
 * - 接口出错 / 超额度 / 没配置时返回 unavailable，不影响下单。
 * - 模拟模式下（没填密钥）用简单规则模拟，方便演示和测试。
 */
import crypto from "node:crypto";
import { db, getSettings } from "./db";
import { isMockMode } from "./shipbest/client";
import type { Address } from "./shipbest/types";

export type AddressStatus =
  | "ok" // 地址正确
  | "corrected" // 地址存在，写法有修正（缩写、ZIP+4 等）
  | "missing_unit" // 楼存在，但需要公寓 / 单元号
  | "bad_unit" // 填了公寓号，但 USPS 查不到这个单元
  | "not_found" // USPS 查不到这个地址
  | "unavailable" // 没有核对（未启用、接口出错、超额度）
  | "skipped"; // 非美国地址，不核对

export interface AddressCheck {
  status: AddressStatus;
  /** USPS 的标准写法（和原地址不同时才有） */
  suggestion?: Partial<Address>;
  /** 住宅 / 商业地址 */
  business?: boolean;
  /** 说明（中文，界面上翻译） */
  message?: string;
  checkedAt?: string;
  /** 客户确认过这个有问题的地址 */
  acknowledged?: boolean;
}

/** 这些结果下单前要客户确认 */
export const NEEDS_ACK: AddressStatus[] = ["missing_unit", "bad_unit", "not_found"];
export const needsAck = (c: AddressCheck | null | undefined) => !!c && NEEDS_ACK.includes(c.status);

export function uspsConfig() {
  const u = getSettings().usps ?? { enabled: false, consumerKey: "", consumerSecret: "" };
  const consumerKey = u.consumerKey || process.env.USPS_CONSUMER_KEY || "";
  const consumerSecret = u.consumerSecret || process.env.USPS_CONSUMER_SECRET || "";
  return { enabled: u.enabled !== false && !!(consumerKey && consumerSecret), consumerKey, consumerSecret, configured: !!(consumerKey && consumerSecret) };
}

const BASE = "https://apis.usps.com";
let token: { key: string; value: string; exp: number } | null = null;

async function accessToken(key: string, secret: string, scope?: string): Promise<string> {
  const tag = key + (scope ?? "");
  if (token && token.key === tag && token.exp > Date.now() + 60_000) return token.value;
  const res = await fetch(`${BASE}/oauth2/v3/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: key, client_secret: secret, ...(scope ? { scope } : {}) }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`USPS 授权失败：${j.error_description || j.error || res.status}`);
  token = { key: tag, value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return token.value;
}

const up = (s?: string | null) => (s ?? "").toUpperCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();
const zip5 = (z?: string | null) => (z ?? "").match(/\d{5}/)?.[0] ?? "";

function cacheKey(a: Partial<Address>) {
  const k = [a.address1, a.address2, a.city, a.province, zip5(a.zipCode)].map(up).join("|");
  return crypto.createHash("sha1").update(k).digest("hex");
}

function ensure() {
  const c = db();
  c.exec("CREATE TABLE IF NOT EXISTS address_checks (key TEXT PRIMARY KEY, json TEXT NOT NULL, checked_at TEXT NOT NULL DEFAULT (datetime('now')))");
  return c;
}

function cached(key: string): AddressCheck | null {
  const r = ensure().prepare("SELECT json, checked_at FROM address_checks WHERE key = ?").get(key) as
    | { json: string; checked_at: string }
    | undefined;
  return r ? { ...JSON.parse(r.json), checkedAt: r.checked_at } : null;
}

function remember(key: string, c: AddressCheck) {
  if (c.status === "unavailable" || c.status === "skipped") return;
  ensure()
    .prepare("INSERT INTO address_checks (key, json, checked_at) VALUES (?,?, datetime('now')) ON CONFLICT(key) DO UPDATE SET json = excluded.json, checked_at = excluded.checked_at")
    .run(key, JSON.stringify(c));
}

/** 解析 USPS 返回：DPVConfirmation Y=正确 D=缺单元号 S=单元号不对 N=不存在 */
export function interpretUsps(input: Partial<Address>, j: {
  address?: { streetAddress?: string; secondaryAddress?: string; city?: string; state?: string; ZIPCode?: string; ZIPPlus4?: string };
  additionalInfo?: { DPVConfirmation?: string; business?: string; vacant?: string };
}): AddressCheck {
  const a = j.address ?? {};
  const dpv = (j.additionalInfo?.DPVConfirmation ?? "").toUpperCase();
  const business = j.additionalInfo?.business === "Y";
  const suggestion: Partial<Address> = {
    address1: a.streetAddress || input.address1,
    address2: a.secondaryAddress || input.address2 || "",
    city: a.city || input.city,
    province: a.state || input.province,
    zipCode: a.ZIPCode ? (a.ZIPPlus4 ? `${a.ZIPCode}-${a.ZIPPlus4}` : a.ZIPCode) : input.zipCode,
  };
  const differs =
    up(suggestion.address1) !== up(input.address1) ||
    up(suggestion.address2) !== up(input.address2) ||
    up(suggestion.city) !== up(input.city) ||
    up(suggestion.province) !== up(input.province) ||
    zip5(suggestion.zipCode) !== zip5(input.zipCode);
  if (dpv === "N" || !dpv) return { status: "not_found", message: "USPS 查不到这个地址，可能不存在或写错了" };
  if (dpv === "D") return { status: "missing_unit", business, suggestion: differs ? suggestion : undefined, message: "这个地址需要公寓 / 单元号（Apt / Unit / Suite）" };
  if (dpv === "S") return { status: "bad_unit", business, suggestion: differs ? suggestion : undefined, message: "USPS 查不到这个公寓 / 单元号，请检查" };
  return differs ? { status: "corrected", business, suggestion, message: "地址存在，USPS 建议的标准写法如下" } : { status: "ok", business, message: "地址已验证" };
}

/** 模拟核对（没配置 USPS 时，在模拟模式下用于演示） */
function mockCheck(a: Partial<Address>): AddressCheck {
  const street = up(a.address1);
  if (!/^\d+\s+\S+/.test(street) || zip5(a.zipCode) === "00000" || /NOWHERE|FAKE|TEST ST/.test(street))
    return { status: "not_found", message: "USPS 查不到这个地址，可能不存在或写错了" };
  if (/\b(APARTMENTS?|TOWER|CONDO)\b/.test(street) && !up(a.address2)) return { status: "missing_unit", message: "这个地址需要公寓 / 单元号（Apt / Unit / Suite）" };
  const std = street.replace(/\bSTREET\b/, "ST").replace(/\bAVENUE\b/, "AVE").replace(/\bROAD\b/, "RD").replace(/\bBOULEVARD\b/, "BLVD");
  if (std !== street) return { status: "corrected", suggestion: { ...a, address1: std }, message: "地址存在，USPS 建议的标准写法如下" };
  return { status: "ok", message: "地址已验证" };
}

export async function checkAddress(a: Partial<Address> | null | undefined, opts: { fresh?: boolean; force?: boolean } = {}): Promise<AddressCheck> {
  if (!a) return { status: "unavailable" };
  if ((a.country || "US").toUpperCase() !== "US") return { status: "skipped" };
  if (!a.address1 || !zip5(a.zipCode)) return { status: "unavailable" };
  const cfg = uspsConfig();
  if (!cfg.enabled && !(opts.force && cfg.configured)) return isMockMode() && !cfg.configured ? mockCheck(a) : { status: "unavailable" };
  const key = cacheKey(a);
  if (!opts.fresh) {
    const hit = cached(key);
    if (hit) return hit;
  }
  try {
    const q = new URLSearchParams({ streetAddress: a.address1 ?? "", state: (a.province ?? "").toUpperCase(), ZIPCode: zip5(a.zipCode) });
    if (a.address2) q.set("secondaryAddress", a.address2);
    if (a.city) q.set("city", a.city);
    const call = async (tk: string) =>
      fetch(`${BASE}/addresses/v3/address?${q}`, {
        headers: { Authorization: `Bearer ${tk}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
    let res = await call(await accessToken(cfg.consumerKey, cfg.consumerSecret));
    // 403：令牌里可能没带地址接口的权限，指定 scope 再要一次令牌重试
    if (res.status === 403) res = await call(await accessToken(cfg.consumerKey, cfg.consumerSecret, "addresses"));
    const j = await res.json().catch(() => ({}));
    let result: AddressCheck;
    if (res.ok) result = interpretUsps(a, j);
    else if (res.status === 400 || res.status === 404) result = { status: "not_found", message: "USPS 查不到这个地址，可能不存在或写错了" };
    else {
      if (res.status === 429) return { status: "unavailable", message: "USPS 查询次数已达上限，稍后再试" };
      // 带上 USPS 返回的原因，方便排查（例如 403：App 没有地址接口的权限）
      const e = j as { error?: { message?: string; code?: string } | string; message?: string };
      const reason = (typeof e.error === "object" ? e.error?.message : e.error) || e.message || "";
      return { status: "unavailable", message: `USPS 暂时无法核对（${res.status}${reason ? `：${String(reason).slice(0, 160)}` : ""}）` };
    }
    remember(key, result);
    return { ...result, checkedAt: new Date().toISOString() };
  } catch (e) {
    return { status: "unavailable", message: `USPS 暂时无法核对：${(e as Error).message}` };
  }
}

/** 设置页“测试连接”：查一个已知存在的地址 */
export async function testUsps(): Promise<string> {
  const cfg = uspsConfig();
  if (!cfg.configured) throw new Error("请先填写 USPS Consumer Key 和 Consumer Secret");
  token = null;
  const r = await checkAddress({ country: "US", address1: "1600 Pennsylvania Ave NW", city: "Washington", province: "DC", zipCode: "20500" }, { fresh: true, force: true });
  if (r.status === "unavailable") throw new Error(r.message || "USPS 暂时无法核对");
  return "USPS 连接成功";
}
