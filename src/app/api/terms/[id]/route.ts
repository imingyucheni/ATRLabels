import { currentAdmin, currentCustomerId } from "@/lib/auth";
import { customerAccess } from "@/lib/adminSession";
import { acceptanceById, acceptanceDocument, acceptanceFilename } from "@/lib/terms";

/** 下载一份签署存档（HTML）：管理员可下载任何客户的；客户只能下载自己的 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = acceptanceById(Number((await ctx.params).id));
  const who = await currentAdmin();
  if (!who) {
    const own = await currentCustomerId();
    if (!own) return new Response("Unauthorized", { status: 401 });
    if (!a || a.customerId !== own) return new Response("Not found", { status: 404 });
  } else if (a && !customerAccess(who, a.customerId)) return new Response("Not found", { status: 404 });
  if (!a) return new Response("Not found", { status: 404 });
  return new Response(acceptanceDocument(a), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="agreement-${a.id}.html"; filename*=UTF-8''${encodeURIComponent(acceptanceFilename(a))}`,
    },
  });
}
