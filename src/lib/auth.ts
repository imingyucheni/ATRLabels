import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCustomer, getPasswordHash, type Customer } from "./db";

const COOKIE = "atr_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 天

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("请在环境变量中设置 SESSION_SECRET（至少 16 个字符）");
  return s;
}

function mac(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkPassword(input: string): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) throw new Error("请在环境变量中设置 ADMIN_PASSWORD");
  // 比较 HMAC 摘要，长度固定，避免泄露密码长度
  return safeEqual(mac("pw:" + input), mac("pw:" + pw));
}

export async function createSession() {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const token = `${exp}.${mac(`admin.${exp}`)}`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function isLoggedIn(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, mac(`admin.${exp}`));
}

/** 页面和 Server Action 开头调用：未登录则跳转到登录页。 */
export async function requireAdmin() {
  if (!(await isLoggedIn())) redirect("/login");
}

/* ---------------- 登录失败限制 ---------------- */

const failures = new Map<string, { count: number; until: number }>();

/** 同一个 key 15 分钟内失败 10 次后锁定 15 分钟 */
export function checkRateLimit(key: string): string | null {
  const f = failures.get(key);
  if (f && f.count >= 10 && f.until > Date.now()) return "尝试次数过多，请 15 分钟后再试";
  return null;
}

export function recordFailure(key: string) {
  const f = failures.get(key);
  const now = Date.now();
  if (!f || f.until < now) failures.set(key, { count: 1, until: now + 15 * 60_000 });
  else f.count++;
}

export function clearFailures(key: string) {
  failures.delete(key);
}

/* ---------------- 客户登录 ---------------- */

const PORTAL_COOKIE = "atr_portal";

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(pw: string, stored: string | null): boolean {
  if (!stored) return false;
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const test = scryptSync(pw, salt, 32).toString("hex");
  return safeEqual(test, hash);
}

/** 会话里带上密码哈希的一部分：客户改密码或被重置后，旧会话自动失效 */
function portalMac(id: number, exp: number, pwHash: string) {
  return mac(`cust.${id}.${exp}.${pwHash.slice(-16)}`);
}

export async function createCustomerSession(id: number, pwHash: string) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  (await cookies()).set(PORTAL_COOKIE, `${id}.${exp}.${portalMac(id, exp, pwHash)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroyCustomerSession() {
  (await cookies()).delete(PORTAL_COOKIE);
}

/** 返回已登录客户的 id；未登录、会话过期、账号停用都返回 null */
export async function currentCustomerId(): Promise<number | null> {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!token) return null;
  const [idStr, expStr, sig] = token.split(".");
  const id = Number(idStr);
  const exp = Number(expStr);
  if (!id || !exp || !sig || exp < Date.now() / 1000) return null;
  const c = getCustomer(id);
  const pwHash = getPasswordHash(id);
  if (!c?.portalEnabled || !pwHash) return null;
  return safeEqual(sig, portalMac(id, exp, pwHash)) ? id : null;
}

/** 客户端页面和 Server Action 开头调用 */
export async function requireCustomer(): Promise<Customer> {
  const id = await currentCustomerId();
  if (!id) redirect("/portal/login");
  return getCustomer(id)!;
}
