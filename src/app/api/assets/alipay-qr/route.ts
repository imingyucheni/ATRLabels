import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { readAlipayQr } from "@/lib/topup";

/** 支付宝收款码图片（登录后可见） */
export async function GET() {
  if (!(await isLoggedIn()) && !(await currentCustomerId())) return new Response("Unauthorized", { status: 401 });
  const f = readAlipayQr();
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(f.buf), { headers: { "Content-Type": f.mime, "Cache-Control": "private, max-age=300" } });
}
