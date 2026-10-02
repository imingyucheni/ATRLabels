/**
 * 后台登录令牌（不依赖 Next 的请求上下文，proxy 和页面都能用）。
 * - 主管理员：`${过期时间}.${HMAC}`，HMAC 里带着管理员密码的指纹，改密码后旧登录全部失效。
 * - 员工（二级管理员）：`s.${id}.${会话版本}.${过期时间}.${HMAC}`；停用 / 改密码会换会话版本，旧登录失效。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { customerLevel, getStaff, staffSessionValid, type AccessLevel } from "./staffStore";

// 沙盒站和正式站可能在同一个 IP 的不同端口上，浏览器 cookie 不分端口：沙盒站用不同的 cookie 名
export const ADMIN_COOKIE = "atr_session" + (process.env.APP_ENV === "sandbox" ? "_sb" : "");

export type AdminPrincipal = { role: "owner"; id: 0; name: string } | { role: "staff"; id: number; name: string; username: string };

/** 主管理员在记录里显示的名字 */
export const OWNER_NAME = "主管理员";

function mac(payload: string) {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("请在环境变量中设置 SESSION_SECRET（至少 16 个字符）");
  return createHmac("sha256", s).update(payload).digest("hex");
}

export const adminMac = (exp: string | number) => mac(`admin.${exp}.${mac("pw:" + (process.env.ADMIN_PASSWORD ?? "")).slice(0, 16)}`);
const staffMac = (id: number | string, ver: string, exp: string | number) => mac(`staff.${id}.${ver}.${exp}`);

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function staffToken(id: number, ver: string, exp: number) {
  return `s.${id}.${ver}.${exp}.${staffMac(id, ver, exp)}`;
}

/** 校验令牌，返回登录的是谁；无效返回 null */
export function verifySession(token: string | undefined | null): AdminPrincipal | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts[0] === "s" && parts.length === 5) {
    const [, idS, ver, exp, sig] = parts;
    const id = Number(idS);
    if (!(id > 0) || !ver || Number(exp) < Date.now() / 1000 || !same(sig, staffMac(id, ver, exp))) return null;
    const s = staffSessionValid(id, ver);
    return s ? { role: "staff", id: s.id, name: s.name, username: s.username } : null;
  }
  if (parts.length !== 2) return null;
  const [exp, sig] = parts;
  if (!exp || !sig || Number(exp) < Date.now() / 1000 || !same(sig, adminMac(exp))) return null;
  return { role: "owner", id: 0, name: OWNER_NAME };
}

/** 只认主管理员（系统设置、成本利润、备份等） */
export function verifyAdminToken(token: string | undefined | null): boolean {
  return verifySession(token)?.role === "owner";
}

/**
 * 员工能打开的后台页面：客户（开户、设置邮费）、客户咨询、运费试算、财务充值确认、自己的账号。
 * 其他页面（概览、报表、面单记录、设置、备份、佣金…）看得到成本和利润，只有主管理员能开。
 */
export const STAFF_PAGES = [/^\/customers(\/|$)/, /^\/leads(\/|$)/, /^\/quote(\/|$)/, /^\/finance(\/|$)/, /^\/account(\/|$)/];
export const staffCanOpen = (path: string) => STAFF_PAGES.some((re) => re.test(path));

/** 后台登录的人对某个客户的权限：主管理员全部能操作；员工按授权；null = 看不到 */
export function customerAccess(who: AdminPrincipal | null, customerId: number): AccessLevel | null {
  if (!who) return null;
  if (who.role === "owner") return "edit";
  return customerLevel(getStaff(who.id), customerId);
}

/** 列表过滤用：这个客户能不能看到（主管理员全部能看） */
export function customerFilter(who: AdminPrincipal | null): (customerId: number) => boolean {
  if (!who) return () => false;
  if (who.role === "owner") return () => true;
  const s = getStaff(who.id);
  return (customerId) => customerLevel(s, customerId) !== null;
}

/** 客户详情这类带客户 id 的页面：/customers/123、/customers/123/statement … */
export function customerIdInPath(path: string): number | null {
  const m = path.match(/^\/customers\/(\d+)(\/|$)/);
  return m ? Number(m[1]) : null;
}
