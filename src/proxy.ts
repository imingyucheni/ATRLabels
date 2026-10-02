import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, staffCanOpen, verifySession } from "@/lib/adminSession";

/**
 * 后台页面必须先登录：在这里拦，不能只靠 (admin)/layout 里的 requireAdmin。
 * Next 会同时渲染 layout 和页面，layout 跳转到登录页时，页面的数据已经一起发出去了。
 * 不需要登录的：登录页、客户 OMS（/portal 自己检查客户登录）、官网、接口（各自检查身份）、图标 / manifest。
 */
const PUBLIC = [/^\/login(\/|$)/, /^\/portal(\/|$)/, /^\/site(\/|$)/, /^\/api\//, /^\/manifest\.webmanifest$/, /^\/(icon|apple-icon)[^/]*$/];

function who(req: NextRequest) {
  try {
    return verifySession(req.cookies.get(ADMIN_COOKIE)?.value);
  } catch {
    return null;
  }
}

/**
 * 没登录打开后台页面：直接跳登录页，页面不渲染。
 * 员工（二级管理员）只能开客户、客户咨询、运费试算、财务、自己的账号这几个页面，其他的跳到客户列表。
 */
function guardAdmin(req: NextRequest): NextResponse | null {
  const path = req.nextUrl.pathname;
  if (PUBLIC.some((re) => re.test(path))) return null;
  const w = who(req);
  if (!w) return NextResponse.redirect(loginUrl(req));
  if (w.role === "staff" && !staffCanOpen(path)) return NextResponse.redirect(siteUrl(req, "/customers"));
  return null;
}

/**
 * 跳转用的完整网址：程序在反向代理后面时 req.url 是内部地址（localhost），
 * 所以优先用 ADMIN_URL，其次用反向代理传来的 X-Forwarded-Host / Host。
 */
function loginUrl(req: NextRequest): URL {
  return siteUrl(req, "/login");
}

function siteUrl(req: NextRequest, to: string): URL {
  const admin = process.env.ADMIN_URL?.replace(/\/+$/, "");
  if (admin) {
    try {
      return new URL(to, admin);
    } catch {
      /* 配置写错就按请求头 */
    }
  }
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  const proto = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")).split(",")[0].trim() || "http";
  try {
    if (host) return new URL(to, `${proto}://${host}`);
  } catch {
    /* 主机名不合法就用 Next 解析的地址 */
  }
  const u = req.nextUrl.clone();
  u.pathname = to;
  u.search = "";
  return u;
}

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
  if (!omsHost) return guardAdmin(req) ?? NextResponse.next();
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").toLowerCase();
  const path = req.nextUrl.pathname;
  const isPortal = path === "/portal" || path.startsWith("/portal/");

  if (host === omsHost) {
    // OMS 网址：首页显示官网（/site），页面只开放官网和 /portal；接口（面单、导出等）自己会检查登录身份
    if (path === "/") {
      // 首页显示官网：加一个请求头，由 next.config 里的 rewrites 做站内转发到 /site。
      // （不在这里直接 NextResponse.rewrite：放在反向代理后面、程序只监听 127.0.0.1 时，
      //  Next 会把它当成外部网址 https://localhost:3000/site 去代理，报 500）
      const headers = new Headers(req.headers);
      headers.set("x-atr-oms-home", "1");
      return NextResponse.next({ request: { headers } });
    }
    if (isPortal || path === "/site" || path.startsWith("/site/") || path.startsWith("/api/") || path === "/manifest.webmanifest") return NextResponse.next();
    return NextResponse.redirect(new URL("/portal", omsUrl));
  }
  if (adminHost && host === adminHost && isPortal) {
    return NextResponse.redirect(new URL(path + req.nextUrl.search, omsUrl));
  }
  const guard = guardAdmin(req);
  if (guard) return guard;
  // 这个头只能由上面加：外面带进来的去掉
  if (req.headers.has("x-atr-oms-home")) {
    const headers = new Headers(req.headers);
    headers.delete("x-atr-oms-home");
    return NextResponse.next({ request: { headers } });
  }
  return NextResponse.next();
}

export const config = {
  // 静态文件不经过这里
  matcher: ["/((?!_next/|favicon|.*\\.(?:png|jpg|jpeg|svg|ico|css|js|woff2?)$).*)"],
};
