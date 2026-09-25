import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { getShipment } from "@/lib/db";
import { readLabel } from "@/lib/labels";

/** 面单文件：后台可以看全部，客户只能看自己的 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = getShipment(Number((await ctx.params).id));
  const admin = await isLoggedIn();
  if (!admin) {
    const own = await currentCustomerId();
    if (!own) return new Response("Unauthorized", { status: 401 });
    if (!s || s.customerId !== own) return new Response("面单不存在", { status: 404 });
  }
  if (!s?.labelPath) return new Response("面单不存在", { status: 404 });
  const buf = readLabel(s.labelPath);
  const download = new URL(req.url).searchParams.has("download");
  const ext = s.labelPath.split(".").pop();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": s.labelMime || "application/octet-stream",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${s.trackingNo || s.customNo}.${ext}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
