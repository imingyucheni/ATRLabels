import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCustomer, getPasswordHash, isInternalCustomer, type Customer } from "./db";
import { ADMIN_COOKIE, adminMac, customerAccess, staffToken, verifyAdminToken, verifySession, type AdminPrincipal } from "./adminSession";
import { setInternalCustomerCheck, type StaffAccount } from "./staffStore";

// 员工权限里要排除公司自用账户（成本价）：staffStore 不打开数据库，在这里告诉它怎么判断
setInternalCustomerCheck(isInternalCustomer);

// 沙盒站和正式站可能在同一个 IP 的不同端口上，浏览器 cookie 不分端口：沙盒站用不同的 cookie 名，两边可以同时登录
const SFX = process.env.APP_ENV === "sandbox" ? "_sb" : "";
const COOKIE = ADMIN_COOKIE;
const MAX_AGE = 60 * 60 * 24 * 7; // 7 天

/**
 * Cookie 是否只走 HTTPS：COOKIE_SECURE=1 强制开启、=0 关闭；
 * 不设置时按请求是否 HTTPS 自动判断（反向代理需传 X-Forwarded-Proto）。
 * 这样用 http://服务器IP 测试时也能正常登录。
 */
async function cookieSecure() {
  if (process.env.COOKIE_SECURE === "1") return true;
  if (process.env.COOKIE_SECURE === "0") return false;
  const h = await headers();
  return (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";
}

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

/** 管理员会话里带上密码指纹：改了 ADMIN_PASSWORD 之后，旧的登录全部失效 */

/** 登录：不传 = 主管理员；传员工账号 = 员工登录（员工 12 小时后要重新登录） */
export async function createSession(staff?: StaffAccount) {
  const maxAge = staff ? 60 * 60 * 12 : MAX_AGE;
  const exp = Math.floor(Date.now() / 1000) + maxAge;
  const token = staff ? staffToken(staff.id, staff.ver, exp) : `${exp}.${adminMac(exp)}`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await cookieSecure(),
    path: "/",
    maxAge,
  });
}

export async function destroySession() {
  const jar = await cookies();
  // 主管理员退出后台：代操作客户 OMS 也一起结束（同一个网址时直接删掉；OMS 在另一个域名时记下退出时间，之前进入的代操作作废）
  let owner = false;
  try {
    owner = verifyAdminToken(jar.get(COOKIE)?.value);
  } catch {
    /* 没配置 SESSION_SECRET：本来就登录不了 */
  }
  if (owner) {
    asState.ownerLogoutAt = Date.now();
    jar.delete(AS_COOKIE);
  }
  jar.delete(COOKIE);
}

/** 是否主管理员登录（接口默认只认主管理员） */
export async function isLoggedIn(): Promise<boolean> {
  return verifyAdminToken((await cookies()).get(COOKIE)?.value);
}

/** 现在登录后台的是谁（主管理员 / 员工）；没登录返回 null */
export async function currentAdmin(): Promise<AdminPrincipal | null> {
  return verifySession((await cookies()).get(COOKIE)?.value);
}

/**
 * 页面和 Server Action 开头调用：未登录跳登录页。
 * 默认只有主管理员能用；员工也能做的操作（开客户账号、设置客户邮费、确认充值）传 { staff: true }。
 * 返回登录的人（记录“谁操作的”用）。
 */
export async function requireAdmin(opts: { staff?: boolean } = {}): Promise<AdminPrincipal> {
  const who = await currentAdmin();
  if (!who) redirect("/login");
  if (who.role === "staff" && !opts.staff) redirect("/customers?denied=1");
  return who;
}

/**
 * 员工对这个客户有没有权限：need = "view" 只看，"edit" 要操作。
 * 有权限返回 null；没有返回错误说明（Server Action 直接 return { error }）。主管理员永远有权限。
 */
export function customerDenied(who: AdminPrincipal, customerId: number, need: "view" | "edit" = "edit"): string | null {
  const lvl = customerAccess(who, customerId);
  if (!lvl) return "你没有这个客户的权限，请找主管理员授权";
  if (need === "edit" && lvl !== "edit") return "这个客户你只有查看权限，不能操作";
  return null;
}

/* ---------------- 登录失败限制 ---------------- */

const failures = new Map<string, { count: number; until: number }>();

/**
 * 访客 IP：取 X-Forwarded-For 的最后一段（Caddy 反向代理加上的真实来源），
 * 第一段是访客自己可以随便填的，不能用来限流，也不能用来核对 IP 白名单。
 * 后台 / 客户登录限流和开放 API 的 IP 白名单都用这一个规则。
 */
export function ipFromHeaders(h: { get(name: string): string | null }): string | null {
  const parts = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] || h.get("x-real-ip")?.trim() || null;
}

export async function clientIp(): Promise<string> {
  return ipFromHeaders(await headers()) ?? "local";
}

/** 同一个 key 15 分钟内失败 max 次（默认 10）后锁定 15 分钟 */
export function checkRateLimit(key: string, max = 10): string | null {
  const f = failures.get(key);
  if (f && f.count >= max && f.until > Date.now()) return "尝试次数过多，请 15 分钟后再试";
  return null;
}

export function recordFailure(key: string) {
  const f = failures.get(key);
  const now = Date.now();
  // 过期的记录定期清掉，避免被大量不同的 key 撑大内存
  if (failures.size > 5000) for (const [k, v] of failures) if (v.until < now) failures.delete(k);
  if (!f || f.until < now) failures.set(key, { count: 1, until: now + 15 * 60_000 });
  else f.count++;
}

export function clearFailures(key: string) {
  failures.delete(key);
}

/* ---------------- 客户登录 ---------------- */

const PORTAL_COOKIE = "atr_portal" + SFX;

export { hashPassword, verifyPassword } from "./password";

/** 会话里带上密码哈希的一部分：客户改密码或被重置后，旧会话自动失效 */
function portalMac(id: number, exp: number, pwHash: string) {
  return mac(`cust.${id}.${exp}.${pwHash.slice(-16)}`);
}

export async function createCustomerSession(id: number, pwHash: string) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  (await cookies()).set(PORTAL_COOKIE, `${id}.${exp}.${portalMac(id, exp, pwHash)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: await cookieSecure(),
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroyCustomerSession() {
  (await cookies()).delete(PORTAL_COOKIE);
}

/* ---------------- 管理员进入客户 OMS（代客户操作） ---------------- */

const AS_COOKIE = "atr_portal_as" + SFX;
const AS_MAX_AGE = 4 * 3600;

const usedEnterTokens = new Map<string, number>();

/**
 * 代操作会话的进程内状态（放在 globalThis：同一个进程里各处共用）：
 * - ownerLogoutAt：主管理员最近一次退出后台的时间，之前进入的代操作作废；
 * - bootAt：程序启动时间。退出时间只记在内存里，重启后就忘了，所以 OMS 在另一个域名时，重启前进入的代操作也作废（重新进入即可）。
 */
const asState = ((globalThis as unknown as { __atrAsState?: { ownerLogoutAt: number; bootAt: number } }).__atrAsState ??= { ownerLogoutAt: 0, bootAt: Date.now() });

/** 后台密码的指纹：改了 ADMIN_PASSWORD，之前进入的代操作全部失效（和后台登录一样） */
const ownerPwFingerprint = () => mac("pw:" + (process.env.ADMIN_PASSWORD ?? "")).slice(0, 16);
const asMac = (id: number, exp: number, iat: number) => mac(`as.${id}.${exp}.${iat}.${ownerPwFingerprint()}`);

const hostOf = (u?: string) => {
  try {
    return u ? new URL(u).host.toLowerCase() : "";
  } catch {
    return "";
  }
};

/** 客户 OMS 是不是单独的域名（配置了 OMS_URL，且和 ADMIN_URL 不同）：这时 OMS 那边收不到后台的登录 cookie */
const omsOnOwnHost = () => {
  const oms = hostOf(process.env.OMS_URL);
  return !!oms && oms !== hostOf(process.env.ADMIN_URL);
};

/** 后台生成的一次性进入凭证（60 秒有效），放在跳转链接里，OMS 可以在另一个域名 */
export function makeEnterToken(customerId: number) {
  const exp = Math.floor(Date.now() / 1000) + 60;
  return `${customerId}.${exp}.${mac(`enter.${customerId}.${exp}`)}`;
}

/** OMS 这边校验进入凭证，写入“管理员代操作”会话。公司自用账户（成本价）不能进入：它只给“管理员下单”用 */
export async function enterAsCustomer(token: string): Promise<number | null> {
  const [idStr, expStr, sig] = token.split(".");
  const id = Number(idStr);
  const exp = Number(expStr);
  if (!id || !exp || !sig || exp < Date.now() / 1000 || !safeEqual(sig, mac(`enter.${id}.${exp}`))) return null;
  const c = getCustomer(id);
  if (!c || c.internal) return null;
  // 一次性：用过的凭证不能再用
  const now = Date.now() / 1000;
  for (const [k, e] of usedEnterTokens) if (e < now) usedEnterTokens.delete(k);
  if (usedEnterTokens.has(sig)) return null;
  usedEnterTokens.set(sig, exp);
  const asExp = Math.floor(Date.now() / 1000) + AS_MAX_AGE;
  const iat = Date.now();
  (await cookies()).set(AS_COOKIE, `${id}.${asExp}.${iat}.${asMac(id, asExp, iat)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: await cookieSecure(),
    path: "/",
    maxAge: AS_MAX_AGE,
  });
  return id;
}

export async function leaveCustomer() {
  (await cookies()).delete(AS_COOKIE);
}

/**
 * 管理员代操作的客户 id（没有则 null）。
 * 只在主管理员的后台登录还有效时才认：后台退出、登录过期、改了后台密码，代操作马上失效。
 * OMS 在另一个域名时收不到后台的登录 cookie：靠凭证里的后台密码指纹、主管理员的退出时间来判断。
 * 公司自用账户（成本价）永远不认。
 */
export async function impersonatedCustomerId(): Promise<number | null> {
  const jar = await cookies();
  const token = jar.get(AS_COOKIE)?.value;
  if (!token) return null;
  const [idStr, expStr, iatStr, sig] = token.split(".");
  const id = Number(idStr);
  const exp = Number(expStr);
  const iat = Number(iatStr);
  if (!id || !exp || !iat || !sig || exp < Date.now() / 1000 || !safeEqual(sig, asMac(id, exp, iat))) return null;
  // 进入之后主管理员退出过后台：作废
  if (iat <= asState.ownerLogoutAt) return null;
  const adminToken = jar.get(COOKIE)?.value;
  if (adminToken || !omsOnOwnHost()) {
    // 能看到后台登录（同一个网址）：必须是有效的主管理员登录（员工、过期、伪造的都不行）
    if (!verifyAdminToken(adminToken)) return null;
  } else if (iat < asState.bootAt) {
    // OMS 在另一个域名：重启前进入的不认（退出时间只记在内存里）
    return null;
  }
  const c = getCustomer(id);
  return c && !c.internal ? id : null;
}

/** 当前 OMS 操作人：管理员代操作记为 admin */
export async function portalActor(): Promise<"admin" | "customer"> {
  return (await impersonatedCustomerId()) ? "admin" : "customer";
}

/**
 * 返回已登录客户的 id（管理员代操作时返回被代操作的客户）；未登录、会话过期、账号停用都返回 null。
 * 公司自用账户（成本价、不扣余额）不能登录客户 OMS：即使有它的会话也不认。
 */
export async function currentCustomerId(): Promise<number | null> {
  const as = await impersonatedCustomerId();
  if (as) return as;
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!token) return null;
  const [idStr, expStr, sig] = token.split(".");
  const id = Number(idStr);
  const exp = Number(expStr);
  if (!id || !exp || !sig || exp < Date.now() / 1000) return null;
  const c = getCustomer(id);
  const pwHash = getPasswordHash(id);
  if (!c?.portalEnabled || c.internal || !pwHash) return null;
  return safeEqual(sig, portalMac(id, exp, pwHash)) ? id : null;
}

/** 客户端页面和 Server Action 开头调用 */
export async function requireCustomer(): Promise<Customer> {
  const id = await currentCustomerId();
  if (!id) redirect("/portal/login");
  return getCustomer(id)!;
}
