import { isLoggedIn } from "@/lib/auth";
import { db, getChannel, getSettings, getShipment } from "@/lib/db";
import { mockLabelPdf, readChannelSample, readLabel } from "@/lib/labels";
import { mergeStamp, stampLabelBytes, stampText, type StampConfig } from "@/lib/stamp";

/**
 * 加印位置预览（后台设置页用）：用某个渠道上传的示例面单或最近一张真实面单（都没有就用模拟面单），
 * 按传入的参数加印，不保存任何设置。
 */
export async function GET(req: Request) {
  if (!(await isLoggedIn())) return new Response("Unauthorized", { status: 401 });
  const p = new URL(req.url).searchParams;
  const channel = p.get("channel") || "";
  const base = mergeStamp(getSettings().stamp, channel ? getChannel(channel)?.stamp : null);
  const num = (k: string, d: number) => (p.has(k) && p.get(k) !== "" && Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : d);
  const cfg: StampConfig = {
    ...base,
    x: num("x", base.x),
    y: num("y", base.y),
    fontSize: num("fontSize", base.fontSize),
    maxWidth: num("maxWidth", base.maxWidth),
    maxLines: num("maxLines", base.maxLines),
    rotate: ([0, 90, 180, 270].includes(num("rotate", base.rotate)) ? num("rotate", base.rotate) : 0) as StampConfig["rotate"],
    whiteBg: p.has("whiteBg") ? p.get("whiteBg") === "1" : base.whiteBg,
    bold: p.has("bold") ? p.get("bold") === "1" : base.bold,
    prefix: p.get("prefix") ?? base.prefix,
    showQty: p.has("showQty") ? p.get("showQty") === "1" : base.showQty,
    separator: p.get("separator") ?? base.separator,
  };
  // 找该渠道最近一张有面单的记录
  const row = db()
    .prepare(`SELECT id FROM shipments WHERE label_path IS NOT NULL ${channel ? "AND channel_code = ?" : ""} ORDER BY id DESC LIMIT 1`)
    .get(...(channel ? [channel] : [])) as { id: number } | undefined;
  const s = row ? getShipment(row.id) : null;
  const sample = { skuList: [{ sku: "Buldak-RT-2pk", quantity: 2 }, { sku: "BK-25.4oz-1pk", quantity: 1 }], labelNote: null } as never;
  const text = stampText(s ?? sample, cfg) || "SKU: SAMPLE-001";
  // 优先用该渠道上传的示例面单（专门用来调位置），其次最近一张真实面单，最后用模拟面单
  const sampleFile = channel ? readChannelSample(channel) : null;
  const pdf = sampleFile
    ? await stampLabelBytes(sampleFile.buf, sampleFile.mime, text, cfg)
    : s?.labelPath
      ? await stampLabelBytes(readLabel(s.labelPath), s.labelMime, text, cfg)
      : await stampLabelBytes(mockLabelPdf("SAMPLE"), "application/pdf", text, cfg);
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
}
