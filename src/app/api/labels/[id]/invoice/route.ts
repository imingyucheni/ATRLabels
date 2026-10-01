import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { getShipment } from "@/lib/db";
import { dhlInvoiceBytes } from "@/lib/shipbest/dhl";
import { getT } from "@/lib/prefs";

const TEXT = { "Content-Type": "text/plain; charset=utf-8" };
const fileSafe = (v: string) => v.replace(/[^\w.-]+/g, "_").slice(0, 80);

/** DHL 商业发票（国际件报关用）：后台可以看全部，客户只能看自己的 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const s = getShipment(Number((await ctx.params).id));
  if (!(await isLoggedIn())) {
    const own = await currentCustomerId();
    if (!own) return new Response("Unauthorized", { status: 401 });
    if (!s || s.customerId !== own) return new Response(t("面单不存在"), { status: 404, headers: TEXT });
  }
  const pdf = s ? dhlInvoiceBytes(s.customNo) : null;
  if (!s || !pdf) return new Response(t("这张订单没有商业发票"), { status: 404, headers: TEXT });
  const download = new URL(req.url).searchParams.has("download");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="INVOICE-${fileSafe(s.trackingNo || s.customNo)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
