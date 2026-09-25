import { NextResponse } from "next/server";
import { isLoggedIn, makeEnterToken } from "@/lib/auth";
import { getCustomer } from "@/lib/db";
import { omsOrigin } from "@/lib/sites";
import { getT } from "@/lib/prefs";

/** 后台“进入客户 OMS”：生成 60 秒有效的进入凭证，跳转到客户 OMS */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return new Response("Unauthorized", { status: 401 });
  const id = Number((await ctx.params).id);
  if (!getCustomer(id)) return new Response((await getT())("客户不存在"), { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const origin = omsOrigin() || `${proto}://${host}`;
  return NextResponse.redirect(`${origin}/portal/enter?t=${encodeURIComponent(makeEnterToken(id))}`);
}
