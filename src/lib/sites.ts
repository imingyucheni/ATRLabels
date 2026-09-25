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

/**
 * 正式站 / 沙盒站：沙盒站是单独部署的一套（数据和正式站完全分开），用来测试新功能。
 * 安装脚本会把两边的后台网址写进 PRODUCTION_URL / SANDBOX_URL，后台侧边栏可以一键切过去。
 */
export function siteSwitch(): { toSandbox: boolean; url: string } | null {
  const sandbox = process.env.APP_ENV === "sandbox";
  const url = trim(sandbox ? process.env.PRODUCTION_URL : process.env.SANDBOX_URL);
  return url ? { toSandbox: !sandbox, url } : null;
}
