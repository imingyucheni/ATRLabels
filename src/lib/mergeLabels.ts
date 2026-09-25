import { PDFDocument } from "pdf-lib";
import type { Shipment } from "./db";
import { readLabel } from "./labels";

const W = 288; // 4 in
const H = 432; // 6 in

/** 把多张面单合并成一个 PDF（PDF 直接拷页；PNG/JPG 放到 4x6 页面上） */
export async function mergeLabels(list: Shipment[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const s of list) {
    if (!s.labelPath) continue;
    const buf = readLabel(s.labelPath);
    if (s.labelMime === "application/pdf") {
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    } else if (s.labelMime === "image/png" || s.labelMime === "image/jpeg") {
      const img = s.labelMime === "image/png" ? await out.embedPng(buf) : await out.embedJpg(buf);
      const scale = Math.min(W / img.width, H / img.height);
      const page = out.addPage([W, H]);
      page.drawImage(img, { x: (W - img.width * scale) / 2, y: (H - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
    }
  }
  return out.save();
}
