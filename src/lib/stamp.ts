/**
 * 面单加印 SKU：在 ShipBest 返回的面单上指定位置印上卖家的 SKU。
 * 原始面单文件不改动，打印 / 下载 / 合并打印时实时生成加印版。
 */
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import { getChannel, getCustomer, getSettings, type Shipment } from "./db";
import { readLabel } from "./labels";
import { mergeStamp, type StampConfig } from "./stampConfig";

export * from "./stampConfig";

/** 这张面单是否加印、用什么配置 */
/**
 * 是否加印的优先级：
 * 客户设为不加印 → 不加印；渠道设为不加印 → 不加印；渠道设为加印 → 加印；
 * 否则客户设为加印 → 加印；都没设置 → 跟随全局开关。
 */
export function stampFor(s: Shipment): StampConfig | null {
  const st = getSettings().stamp;
  const mode = getCustomer(s.customerId)?.stampMode ?? "inherit";
  const ch = getChannel(s.channelCode)?.stamp;
  if (mode === "off" || ch?.enabled === false) return null;
  const on = ch?.enabled === true || mode === "on" || (mode === "inherit" && st.enabled);
  if (!on) return null;
  return mergeStamp(st, ch);
}

/** 要印的文字：优先用这张面单单独填写的文字，否则用订单 SKU */
export function stampText(s: Pick<Shipment, "skuList" | "labelNote">, cfg: StampConfig): string {
  if (s.labelNote?.trim()) return s.labelNote.trim();
  const items = s.skuList.filter((k) => k.sku).map((k) => (cfg.showQty && k.quantity > 1 ? `${k.sku} x${k.quantity}` : k.sku));
  return items.length ? cfg.prefix + items.join(cfg.separator) : "";
}

/** 标准字体只支持西文字符，其他字符（例如中文）替换掉，避免生成失败 */
function sanitize(text: string, font: PDFFont): string {
  let out = "";
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur + w;
    if (font.widthOfTextAtSize(next.trim(), size) <= maxW || !cur.trim()) cur = next;
    else {
      lines.push(cur.trim());
      cur = w.trimStart();
    }
  }
  if (cur.trim()) lines.push(cur.trim());
  // 单个词太长时硬切
  return lines.flatMap((l) => {
    if (font.widthOfTextAtSize(l, size) <= maxW) return [l];
    const parts: string[] = [];
    let p = "";
    for (const ch of l) {
      if (font.widthOfTextAtSize(p + ch, size) > maxW && p) {
        parts.push(p);
        p = ch;
      } else p += ch;
    }
    if (p) parts.push(p);
    return parts;
  });
}

const W = 288; // 4 in
const H = 432; // 6 in

/** 把面单（PDF 或图片）加上文字，返回 PDF。text 为空时只做格式统一。 */
export async function stampLabelBytes(buf: Buffer, mime: string | null, text: string, cfg: StampConfig): Promise<Uint8Array> {
  let doc: PDFDocument;
  if (mime === "application/pdf") {
    doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  } else {
    doc = await PDFDocument.create();
    const img = mime === "image/png" ? await doc.embedPng(buf) : await doc.embedJpg(buf);
    const scale = Math.min(W / img.width, H / img.height);
    const page = doc.addPage([W, H]);
    page.drawImage(img, { x: (W - img.width * scale) / 2, y: (H - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
  }
  if (!text) return doc.save();

  const font = await doc.embedFont(cfg.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  const clean = sanitize(text, font);
  const maxW = cfg.maxWidth * 72;
  // 超过最多行数时逐步缩小字号（最小 6pt）
  let size = cfg.fontSize;
  let lines = wrap(clean, font, size, maxW);
  while (lines.length > cfg.maxLines && size > 6) {
    size -= 0.5;
    lines = wrap(clean, font, size, maxW);
  }
  if (lines.length > cfg.maxLines) {
    lines = lines.slice(0, cfg.maxLines);
    lines[lines.length - 1] = lines[lines.length - 1].slice(0, -2) + "..";
  }
  const lineH = size * 1.2;
  const blockW = Math.max(...lines.map((l) => font.widthOfTextAtSize(l, size)));
  const blockH = lineH * lines.length;
  const pad = 2;

  // 只加印第一页（一张面单一页）
  const page = doc.getPage(0);
  const { height } = page.getSize();
  const x0 = cfg.x * 72;
  const top = height - cfg.y * 72; // PDF 坐标原点在左下角
  const rot = degrees(cfg.rotate);
  // 按旋转角度计算每一行的起点（绕块左上角旋转）
  const rad = (cfg.rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const at = (dx: number, dy: number) => ({ x: x0 + dx * cos - dy * sin, y: top + dx * sin + dy * cos });

  if (cfg.whiteBg) {
    const o = at(-pad, -blockH - pad);
    page.drawRectangle({ x: o.x, y: o.y, width: blockW + pad * 2, height: blockH + pad * 2, color: rgb(1, 1, 1), rotate: rot });
  }
  lines.forEach((l, i) => {
    const p = at(0, -(i + 1) * lineH + size * 0.22);
    page.drawText(l, { x: p.x, y: p.y, size, font, color: rgb(0, 0, 0), rotate: rot });
  });
  return doc.save();
}

/** 读取某张面单并按配置加印；不需要加印时返回 null（直接用原文件） */
export async function stampedLabel(s: Shipment): Promise<Uint8Array | null> {
  if (!s.labelPath) return null;
  const cfg = stampFor(s);
  if (!cfg) return null;
  const text = stampText(s, cfg);
  if (!text) return null;
  return stampLabelBytes(readLabel(s.labelPath), s.labelMime, text, cfg);
}

/** 已取消的面单：整页斜印 “VOID / CANCELLED”，防止误贴（后台留档查看用） */
export async function voidLabel(s: Shipment): Promise<Uint8Array | null> {
  if (!s.labelPath) return null;
  const base = (await stampedLabel(s)) ?? (await stampLabelBytes(readLabel(s.labelPath), s.labelMime, "", mergeStamp(getSettings().stamp, null)));
  const doc = await PDFDocument.load(base, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.min(width, height) / 3.2;
    const text = "VOID";
    const tw = font.widthOfTextAtSize(text, size);
    const rad = Math.atan2(height, width);
    // 以页面中心为基准沿对角线居中
    const cx = width / 2 - (tw / 2) * Math.cos(rad) + (size / 3) * Math.sin(rad);
    const cy = height / 2 - (tw / 2) * Math.sin(rad) - (size / 3) * Math.cos(rad);
    page.drawText(text, { x: cx, y: cy, size, font, color: rgb(0.85, 0.1, 0.1), opacity: 0.55, rotate: degrees((rad * 180) / Math.PI) });
    const note = "CANCELLED - DO NOT SHIP";
    const ns = 14;
    page.drawRectangle({ x: 0, y: height - 30, width, height: 30, color: rgb(0.85, 0.1, 0.1) });
    page.drawText(note, { x: (width - font.widthOfTextAtSize(note, ns)) / 2, y: height - 21, size: ns, font, color: rgb(1, 1, 1) });
  }
  return doc.save();
}
