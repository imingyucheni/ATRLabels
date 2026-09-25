/**
 * 管理后台和客户 OMS 可以用两个不同的网址（例如 admin.xxx.com / oms.xxx.com）。
 * 没配置时两者在同一个网址下：后台在 /，客户 OMS 在 /portal。
 */
const trim = (v?: string) => (v ?? "").trim().replace(/\/+$/, "");

/** 客户 OMS 的网址（不带 /portal），例如 https://oms.xxx.com；空 = 和后台同一个网址 */
export const omsOrigin = () => trim(process.env.OMS_URL);
/** 管理后台的网址，例如 https://admin.xxx.com；空 = 同一个网址 */
export const adminOrigin = () => trim(process.env.ADMIN_URL);

/** 客户 OMS 登录页的完整地址（发给客户用） */
export function omsLoginUrl(currentOrigin: string) {
  return `${omsOrigin() || currentOrigin}/portal/login`;
}
