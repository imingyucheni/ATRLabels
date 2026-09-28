import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { getJob } from "@/lib/batch";
import { getShipment } from "@/lib/db";
import { readLabel } from "@/lib/labels";
import { stampedLabel } from "@/lib/stamp";
import { uniqueNames, zipStore } from "@/lib/zip";
import { getT } from "@/lib/prefs";

const TEXT = { "Content-Type": "text/plain; charset=utf-8" };
const safe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);

/** 整批面单打包下载：ZIP 里每单一个文件（和单张下载一样加印 SKU），文件名 = 自定义单号-运单号 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const job = getJob(Number((await ctx.params).id));
  const admin = await isLoggedIn();
  if (!admin) {
    const own = await currentCustomerId();
    if (!own) return new Response("Unauthorized", { status: 401 });
    if (!job || job.customerId !== own) return new Response(t("任务不存在"), { status: 404, headers: TEXT });
  }
  if (!job) return new Response(t("任务不存在"), { status: 404, headers: TEXT });
  const list = job.rows
    .map((r) => (r.shipmentId ? getShipment(r.shipmentId) : null))
    .filter((s): s is NonNullable<typeof s> => !!s?.labelPath && s.status !== "cancelled" && s.status !== "exception");
  if (!list.length) return new Response(t("没有可打印的面单"), { status: 404, headers: TEXT });
  const files = await Promise.all(
    list.map(async (s) => {
      const stamped = await stampedLabel(s);
      const ext = stamped ? "pdf" : s.labelPath!.split(".").pop() || "pdf";
      return { name: `${safe(s.customerRef || s.customNo)}${s.trackingNo ? `-${safe(s.trackingNo)}` : ""}.${ext}`, data: stamped ?? readLabel(s.labelPath!) };
    }),
  );
  const names = uniqueNames(files.map((f) => f.name));
  const zip = zipStore(files.map((f, i) => ({ ...f, name: names[i] })));
  const fname = `${t("批次")}${job.id}-${safe((job.filename ?? "").replace(/\.[^.]+$/, ""))}-${list.length}.zip`;
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="batch-${job.id}.zip"; filename*=UTF-8''${encodeURIComponent(fname)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
