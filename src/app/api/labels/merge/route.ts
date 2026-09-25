import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { getCustomer, getShipment } from "@/lib/db";
import { isPaperSize, layoutLabels, type PaperSize } from "@/lib/labelLayout";
import { mergeLabels } from "@/lib/mergeLabels";
import { getT } from "@/lib/prefs";

/** 合并打印：/api/labels/merge?ids=1,2,3（最多 300 张） */
export async function GET(req: Request) {
  const admin = await isLoggedIn();
  const own = admin ? null : await currentCustomerId();
  if (!admin && !own) return new Response("Unauthorized", { status: 401 });
  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => n > 0)
    .slice(0, 300);
  const list = ids
    .map((id) => getShipment(id))
    .filter((s): s is NonNullable<typeof s> => !!s && !!s.labelPath && s.status !== "cancelled" && (admin || s.customerId === own));
  if (!list.length) return new Response((await getT())("没有可打印的面单"), { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const q = new URL(req.url).searchParams.get("paper");
  const pref = getCustomer(own ?? list[0].customerId)?.labelPaper;
  const paper: PaperSize = isPaperSize(q) ? q : isPaperSize(pref) ? pref : "4x6";
  const pdf = await layoutLabels(await mergeLabels(list), paper);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="labels-${new Date().toISOString().slice(0, 10)}-${list.length}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
