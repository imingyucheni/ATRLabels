import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-proxy-"));

process.env.SESSION_SECRET = "test-secret-1234567890";
process.env.ADMIN_PASSWORD = "pw-1234";
delete process.env.OMS_URL;
delete process.env.ADMIN_URL;

describe("后台页面要先登录（proxy 拦截，页面不渲染）", () => {
  let proxy: typeof import("@/proxy").proxy;
  let token: string;
  beforeAll(async () => {
    proxy = (await import("@/proxy")).proxy;
    const { adminMac } = await import("@/lib/adminSession");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    token = `${exp}.${adminMac(exp)}`;
  });
  const req = (path: string, headers: Record<string, string> = {}) => new NextRequest(new URL(path, "http://localhost:3000"), { headers });

  it("没登录：后台页面一律跳登录页", () => {
    for (const p of ["/", "/customers", "/customers/3", "/commissions", "/finance", "/settings", "/shipments?q=x"]) {
      const r = proxy(req(p));
      expect(r.status, p).toBe(307);
      expect(r.headers.get("location"), p).toBe("http://localhost:3000/login");
    }
  });

  it("反向代理后面跳到外部网址；伪造 / 过期的登录无效", () => {
    expect(proxy(req("/customers", { "x-forwarded-host": "admin.atrship.com", "x-forwarded-proto": "https" })).headers.get("location")).toBe("https://admin.atrship.com/login");
    expect(proxy(req("/customers", { cookie: "atr_session=9999999999.abc" })).status).toBe(307);
    const old = Math.floor(Date.now() / 1000) - 10;
    expect(proxy(req("/customers", { cookie: `atr_session=${old}.${"0".repeat(64)}` })).status).toBe(307);
  });

  it("登录了能打开；登录页、客户 OMS、官网、接口不拦", () => {
    expect(proxy(req("/customers", { cookie: `atr_session=${token}` })).headers.get("location")).toBeNull();
    for (const p of ["/login", "/portal", "/portal/ship", "/site", "/site/developers", "/api/v1/rates", "/manifest.webmanifest", "/icon.svg"]) {
      expect(proxy(req(p)).headers.get("location"), p).toBeNull();
    }
  });

  it("员工登录：只能开客户、咨询、试算、财务、我的账号；其他页面跳回客户列表", async () => {
    const st = await import("@/lib/staffStore");
    const { staffToken } = await import("@/lib/adminSession");
    const id = st.createStaff({ name: "Amy", username: "amy", password: "amy-pass-1" });
    const s = st.getStaff(id)!;
    const cookie = `atr_session=${staffToken(id, s.ver, Math.floor(Date.now() / 1000) + 3600)}`;
    for (const p of ["/customers", "/customers/3?tab=pricing", "/finance", "/quote", "/leads", "/account"]) expect(proxy(req(p, { cookie })).headers.get("location"), p).toBeNull();
    for (const p of ["/", "/reports", "/shipments", "/settings", "/commissions", "/staff", "/backups"]) expect(proxy(req(p, { cookie })).headers.get("location"), p).toBe("http://localhost:3000/customers");
    // 停用后：直接跳登录页
    st.setStaffActive(id, false);
    expect(proxy(req("/customers", { cookie })).headers.get("location")).toBe("http://localhost:3000/login");
  });
});
