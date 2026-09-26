import { NextResponse, type NextRequest } from "next/server";

/**
 * 管理后台和客户 OMS 分开网址（配置了 OMS_URL / ADMIN_URL 时生效）：
 * - 客户 OMS 的网址首页是官网（/site），其余只能打开 /portal，打不开后台页面；
 * - 后台网址打开 /portal 时跳到 OMS 的网址。
 * 没配置时不做任何限制（后台在 /，OMS 在 /portal）。
 */
const hostOf = (u?: string) => {
  try {
    return u ? new URL(u).host.toLowerCase() : "";
  } catch {
    return "";
  }
};

export function proxy(req: NextRequest) {
  const omsUrl = process.env.OMS_URL?.replace(/\/+$/, "");
  const omsHost = hostOf(omsUrl);
  const adminHost = hostOf(process.env.ADMIN_URL);
  if (!omsHost) return NextResponse.next();
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").toLowerCase();
  const path = req.nextUrl.pathname;
  const isPortal = path === "/portal" || path.startsWith("/portal/");

  if (host === omsHost) {
    // OMS 网址：首页显示官网（/site），页面只开放官网和 /portal；接口（面单、导出等）自己会检查登录身份
    if (path === "/") return NextResponse.rewrite(new URL("/site", req.url));
    if (isPortal || path === "/site" || path.startsWith("/site/") || path.startsWith("/api/")) return NextResponse.next();
    return NextResponse.redirect(new URL("/portal", omsUrl));
  }
  if (adminHost && host === adminHost && isPortal) {
    return NextResponse.redirect(new URL(path + req.nextUrl.search, omsUrl));
  }
  return NextResponse.next();
}

export const config = {
  // 静态文件不经过这里
  matcher: ["/((?!_next/|favicon|.*\\.(?:png|jpg|jpeg|svg|ico|css|js|woff2?)$).*)"],
};
