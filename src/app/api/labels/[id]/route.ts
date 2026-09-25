import { isLoggedIn } from "@/lib/auth";
import { getShipment } from "@/lib/db";
import { readLabel } from "@/lib/labels";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return new Response("Unauthorized", { status: 401 });
  const s = getShipment(Number((await ctx.params).id));
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
