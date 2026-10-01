import { handle } from "@/lib/api/http";
import { getLabel } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/orders/{no}/label：面单 PDF；?format=base64 返回 JSON（ERP 多数用这种） */
export const GET = (req: Request, ctx: { params: Promise<{ no: string }> }) =>
  handle(req, async (key) => {
    const l = await getLabel(key, decodeURIComponent((await ctx.params).no));
    if (new URL(req.url).searchParams.get("format") === "base64") {
      return { fileName: l.filename, fileType: l.mime === "application/pdf" ? "pdf" : l.mime.split("/")[1], content: Buffer.from(l.bytes).toString("base64") };
    }
    return new Response(new Uint8Array(l.bytes), {
      headers: { "Content-Type": l.mime, "Content-Disposition": `inline; filename="${l.filename}"`, "Cache-Control": "private, no-store" },
    });
  });
