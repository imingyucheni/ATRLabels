import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { readQr } from "@/lib/topup";

/** Zelle 收款码图片（登录后可见，客户用银行 App 扫码付款） */
export async function GET() {
  if (!(await isLoggedIn()) && !(await currentCustomerId())) return new Response("Unauthorized", { status: 401 });
  const f = readQr("zelle");
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(f.buf), { headers: { "Content-Type": f.mime, "Cache-Control": "private, max-age=300" } });
}
