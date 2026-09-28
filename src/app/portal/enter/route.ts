import { NextResponse } from "next/server";
import { enterAsCustomer } from "@/lib/auth";
import { omsOrigin } from "@/lib/sites";

/** 管理员从后台“进入客户 OMS”：校验一次性凭证后，以该客户身份进入 OMS */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = await enterAsCustomer(url.searchParams.get("t") ?? "");
  // 跳转地址用配置的 OMS 网址；没配置时用当前请求的 Host（不信任 X-Forwarded-Host）
  const origin = omsOrigin() || `${req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")}://${req.headers.get("host") ?? url.host}`;
  return NextResponse.redirect(`${origin}${id ? "/portal" : "/portal/login"}`);
}
