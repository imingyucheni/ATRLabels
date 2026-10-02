import { currentAdmin, currentCustomerId } from "@/lib/auth";
import { customerAccess } from "@/lib/adminSession";
import { getTopup, readTopupProof } from "@/lib/topup";

/** 充值凭证：后台（主管理员、员工确认充值时）可看全部，客户只能看自己的 */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const who = await currentAdmin();
  if (!who) {
    const own = await currentCustomerId();
    if (!own || getTopup(id)?.customerId !== own) return new Response("Not found", { status: 404 });
  } else if (!customerAccess(who, getTopup(id)?.customerId ?? 0)) return new Response("Not found", { status: 404 });
  const f = readTopupProof(id);
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(f.buf), { headers: { "Content-Type": f.mime, "Cache-Control": "private, no-store" } });
}
