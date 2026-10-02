/**
 * 管理员登录令牌的校验（不依赖 Next 的请求上下文，proxy 和页面都能用）。
 * 令牌格式：`${过期时间}.${HMAC}`，HMAC 里带着管理员密码的指纹，改密码后旧登录全部失效。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

// 沙盒站和正式站可能在同一个 IP 的不同端口上，浏览器 cookie 不分端口：沙盒站用不同的 cookie 名
export const ADMIN_COOKIE = "atr_session" + (process.env.APP_ENV === "sandbox" ? "_sb" : "");

function mac(payload: string) {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("请在环境变量中设置 SESSION_SECRET（至少 16 个字符）");
  return createHmac("sha256", s).update(payload).digest("hex");
}

export const adminMac = (exp: string | number) => mac(`admin.${exp}.${mac("pw:" + (process.env.ADMIN_PASSWORD ?? "")).slice(0, 16)}`);

export function verifyAdminToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const want = Buffer.from(adminMac(exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
