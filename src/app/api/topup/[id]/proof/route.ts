import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { getTopup, readTopupProof } from "@/lib/topup";

/** 充值凭证：后台可看全部，客户只能看自己的 */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!(await isLoggedIn())) {
    const own = await currentCustomerId();
    if (!own || getTopup(id)?.customerId !== own) return new Response("Not found", { status: 404 });
  }
  const f = readTopupProof(id);
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(f.buf), { headers: { "Content-Type": f.mime, "Cache-Control": "private, no-store" } });
}
