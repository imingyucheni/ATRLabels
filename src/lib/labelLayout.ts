/**
 * 面单纸张：默认 4×6 热敏纸；也可以打在普通纸上（办公室打印机）：
 * - half：8.5×5.5 英寸半张纸，每页 1 张（面单横放）
 * - letter：8.5×11 英寸整张纸，每页 1 张（面单竖放在上半部分，方便裁剪）
 * - letter2：8.5×11 英寸整张纸，每页 2 张（上下各一张，面单横放）
 */
import { degrees, PDFDocument, rgb } from "pdf-lib";

export type PaperSize = "4x6" | "half" | "letter" | "letter2";

export const PAPER_LABEL: Record<PaperSize, string> = {
  "4x6": "4×6 英寸热敏纸（默认）",
  half: '8.5×5.5" 半张纸（每页 1 张）',
  letter: '8.5×11" 整张纸（每页 1 张）',
  letter2: '8.5×11" 整张纸（每页 2 张）',
};

export const PAPER_SIZES = Object.keys(PAPER_LABEL) as PaperSize[];
export const isPaperSize = (v: unknown): v is PaperSize => PAPER_SIZES.includes(v as PaperSize);

const IN = 72;

/** 把一份 4×6 面单 PDF（可以多页）排到指定纸张上 */
export async function layoutLabels(pdf: Uint8Array, size: PaperSize): Promise<Uint8Array> {
  if (size === "4x6") return pdf;
  const src = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const pages = await out.embedPdf(src, src.getPageIndices());

  // 在 (x, y, w, h) 的格子里放一张面单；rotate = 面单转 90° 横放
  const place = (page: ReturnType<typeof out.addPage>, emb: (typeof pages)[number], box: { x: number; y: number; w: number; h: number }, rotate: boolean) => {
    const lw = rotate ? emb.height : emb.width;
    const lh = rotate ? emb.width : emb.height;
    const scale = Math.min(box.w / lw, box.h / lh, 1); // 保持原尺寸（条码不缩放），放不下时才缩小
    const w = lw * scale;
    const h = lh * scale;
    const x = box.x + (box.w - w) / 2;
    const y = box.y + (box.h - h) / 2;
    if (rotate) {
      // 逆时针转 90°：原点移到右下角
      page.drawPage(emb, { x: x + w, y, xScale: scale, yScale: scale, rotate: degrees(90) });
    } else {
      page.drawPage(emb, { x, y, xScale: scale, yScale: scale });
    }
  };
  const cutLine = (page: ReturnType<typeof out.addPage>, y: number) =>
    page.drawLine({ start: { x: 18, y }, end: { x: 8.5 * IN - 18, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7), dashArray: [4, 4] });

  if (size === "half") {
    for (const emb of pages) {
      const page = out.addPage([8.5 * IN, 5.5 * IN]);
      place(page, emb, { x: 0.25 * IN, y: 0.25 * IN, w: 8 * IN, h: 5 * IN }, emb.height > emb.width);
    }
  } else if (size === "letter") {
    for (const emb of pages) {
      const page = out.addPage([8.5 * IN, 11 * IN]);
      // 竖放在上半部分：4×6 原尺寸，居中
      place(page, emb, { x: 0.25 * IN, y: 11 * IN - 0.5 * IN - 6 * IN, w: 8 * IN, h: 6 * IN }, false);
    }
  } else {
    for (let i = 0; i < pages.length; i += 2) {
      const page = out.addPage([8.5 * IN, 11 * IN]);
      place(page, pages[i], { x: 0.25 * IN, y: 5.5 * IN + 0.25 * IN, w: 8 * IN, h: 5 * IN }, pages[i].height > pages[i].width);
      if (pages[i + 1]) place(page, pages[i + 1], { x: 0.25 * IN, y: 0.25 * IN, w: 8 * IN, h: 5 * IN }, pages[i + 1].height > pages[i + 1].width);
      cutLine(page, 5.5 * IN);
    }
  }
  return out.save();
}
