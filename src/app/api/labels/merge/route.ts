import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { getShipment } from "@/lib/db";
import { mergeLabels } from "@/lib/mergeLabels";

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
    .filter((s): s is NonNullable<typeof s> => !!s && !!s.labelPath && (admin || s.customerId === own));
  if (!list.length) return new Response("没有可打印的面单", { status: 404 });
  const pdf = await mergeLabels(list);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="labels-${new Date().toISOString().slice(0, 10)}-${list.length}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
