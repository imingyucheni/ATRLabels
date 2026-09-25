import { NextResponse } from "next/server";
import { enterAsCustomer } from "@/lib/auth";

/** 管理员从后台“进入客户 OMS”：校验一次性凭证后，以该客户身份进入 OMS */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = await enterAsCustomer(url.searchParams.get("t") ?? "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return NextResponse.redirect(`${proto}://${host}${id ? "/portal" : "/portal/login"}`);
}
