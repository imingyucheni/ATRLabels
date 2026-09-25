import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./db";

function labelsDir() {
  const dir = path.join(dataDir(), "labels");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sniffMime(buf: Buffer, headerType: string | null): { mime: string; ext: string } {
  if (buf.subarray(0, 4).toString("latin1") === "%PDF") return { mime: "application/pdf", ext: "pdf" };
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") return { mime: "image/png", ext: "png" };
  if (buf[0] === 0xff && buf[1] === 0xd8) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.subarray(0, 3).toString("latin1") === "^XA") return { mime: "text/plain", ext: "zpl" };
  const t = (headerType || "application/octet-stream").split(";")[0].trim();
  return { mime: t, ext: "bin" };
}

/**
 * 下载 ShipBest 返回的面单并存到本地。
 * ShipBest 的 labelUrl 可能过期，所以出单后立即保存一份。
 */
export async function downloadLabel(url: string, customNo: string): Promise<{ path: string; mime: string }> {
  let buf: Buffer;
  let headerType: string | null = null;
  if (url.startsWith("mock://")) {
    const q = new URL(url.replace("mock://", "http://mock/")).searchParams;
    buf = mockLabelPdf(customNo, { channel: q.get("ch") ?? undefined, tracking: q.get("t") ?? undefined, to: q.get("to")?.split("|") });
  } else {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (!res.ok) throw new Error(`下载面单失败：HTTP ${res.status}`);
    headerType = res.headers.get("content-type");
    buf = Buffer.from(await res.arrayBuffer());
  }
  const { mime, ext } = sniffMime(buf, headerType);
  const safe = customNo.replace(/[^A-Za-z0-9_-]/g, "_");
  const file = path.join(labelsDir(), `${safe}.${ext}`);
  fs.writeFileSync(file, buf);
  return { path: path.relative(dataDir(), file), mime };
}

export function readLabel(relPath: string): Buffer {
  const base = dataDir();
  const full = path.resolve(base, relPath);
  if (!full.startsWith(base + path.sep)) throw new Error("非法路径");
  return fs.readFileSync(full);
}

/** 生成一张 4x6 英寸的模拟面单 PDF（仅模拟模式使用，版式模仿常见快递面单） */
export function mockLabelPdf(customNo: string, info: { channel?: string; tracking?: string; to?: string[] } = {}): Buffer {
  if (/usps/i.test(info.channel ?? "")) return mockUspsPdf(customNo, info);
  const esc = (t: string) => t.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, (c) => "\\" + c);
  const txt = (x: number, y: number, size: number, t: string, bold = false) => `BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${esc(t)}) Tj ET`;
  const tracking = info.tracking || "9400100000000000000000";
  const to = info.to?.length ? info.to : ["JOHN DOE", "500 CONGRESS AVE", "AUSTIN TX 78701-0001"];
  // 条码：按运单号生成宽窄条
  let bars = "";
  let bx = 24;
  for (const ch of (tracking + tracking).slice(0, 40)) {
    const d = ch.charCodeAt(0) % 4;
    bars += `${bx} 150 ${1 + (d % 2)} 70 re f `;
    bx += 3 + d;
    if (bx > 264) break;
  }
  const content = [
    "0.8 w 8 8 272 416 re S",
    "8 360 m 280 360 l S", "8 250 m 280 250 l S", "8 130 m 280 130 l S", "8 92 m 280 92 l S",
    txt(16, 404, 7, "FROM: ATR WAREHOUSE"), txt(16, 395, 7, "13950 CENTRAL AVE"), txt(16, 386, 7, "CHINO CA 91710"),
    "200 368 72 48 re S", txt(214, 386, 16, "G", true),
    txt(16, 344, 9, "SHIP TO:", true),
    ...to.map((l, i) => txt(16, 328 - i * 14, 12, l.toUpperCase(), true)),
    txt(16, 236, 9, (info.channel || "GROUND").toUpperCase(), true),
    bars,
    txt(40, 138, 9, tracking.replace(/(.{4})/g, "$1 ").trim(), true),
    txt(16, 110, 8, `REF: ${customNo}`),
    txt(16, 98, 6, "MOCK LABEL - NOT FOR SHIPPING"),
  ].join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 288 432] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** 模拟 USPS Ground Advantage 面单版式（按真实面单比例：底栏约 5.35–6 英寸，右下角二维码） */
function mockUspsPdf(_customNo: string, info: { tracking?: string; to?: string[] }): Buffer {
  const esc = (t: string) => t.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, (c) => "\\" + c);
  const Y = (inch: number) => 432 - inch * 72; // 距上边英寸 → PDF 坐标
  const txt = (x: number, y: number, size: number, t: string, bold = false) => `BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${esc(t)}) Tj ET`;
  const hline = (inch: number, w = 1.5) => `${w} w 0 ${Y(inch)} m 288 ${Y(inch)} l S`;
  const tracking = info.tracking || "9214490424544602036283";
  const to = info.to?.length ? info.to : ["THOMAS DOE", "4867 SW TEST ST", "VICTORIA TX 77905"];
  let bars = "";
  let bx = 20;
  for (const ch of (tracking + tracking + tracking).slice(0, 60)) {
    const d = ch.charCodeAt(0) % 4;
    bars += `${bx} ${Y(4.95)} ${1 + (d % 3)} ${0.8 * 72} re f `;
    bx += 3 + d;
    if (bx > 266) break;
  }
  // 二维码占位（右下角）
  let qr = "";
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r * 7 + c * 3 + tracking.length) % 3) qr += `${232 + c * 5} ${Y(5.95) + r * 5} 5 5 re f `;
  const content = [
    "0.8 w 0 0 288 432 re S",
    txt(10, Y(0.33), 11, "UNITED STATES POSTAL SERVICE", true), txt(190, Y(0.33), 14, "USPS APIs", true),
    hline(0.43, 2),
    txt(14, Y(1.2), 60, "G", true), "1 w 88 " + Y(1.48) + " m 88 " + Y(0.43) + " l S",
    txt(96, Y(0.65), 6, "usps.com"), txt(96, Y(0.85), 6, "US POSTAGE", true), txt(180, Y(0.95), 8, "U.S. POSTAGE PAID", true),
    txt(96, Y(1.4), 6, "1 lb 9 oz"), txt(180, Y(1.4), 6, "Mailed from 91710"),
    hline(1.48, 2),
    txt(30, Y(1.75), 14, "USPS GROUND ADVANTAGE", true),
    hline(1.89, 3),
    txt(10, Y(2.1), 6, "ABC"), txt(10, Y(2.2), 6, "5525 DANIELS ST"), txt(10, Y(2.3), 6, "CHINO CA 91710"),
    txt(230, Y(2.3), 11, "RDC 01"),
    ...to.map((l, i) => txt(70, Y(3.3 + i * 0.18), 10, l.toUpperCase())),
    "10 " + Y(3.8) + " 40 40 re S",
    hline(3.95, 3),
    txt(60, Y(4.12), 10, "USPS TRACKING # USPS Ship", true),
    bars,
    txt(60, Y(5.15), 10, tracking.replace(/(.{4})/g, "$1 ").trim(), true),
    hline(5.35, 3),
    qr,
  ].join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 288 432] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/* ---------------- 各渠道示例面单（用来调整加印位置） ---------------- */

function samplesDir() {
  const dir = path.join(dataDir(), "samples");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const safeCode = (code: string) => code.replace(/[^A-Za-z0-9_-]/g, "_");

export function saveChannelSample(code: string, buf: Buffer): { mime: string } {
  const { mime, ext } = sniffMime(buf, null);
  if (!["application/pdf", "image/png", "image/jpeg"].includes(mime)) throw new Error("请上传 PDF、PNG 或 JPG 格式的面单");
  const dir = samplesDir();
  for (const f of fs.readdirSync(dir)) if (f.startsWith(safeCode(code) + ".")) fs.unlinkSync(path.join(dir, f));
  fs.writeFileSync(path.join(dir, `${safeCode(code)}.${ext}`), buf);
  return { mime };
}

export function readChannelSample(code: string): { buf: Buffer; mime: string } | null {
  const dir = samplesDir();
  const f = fs.readdirSync(dir).find((x) => x.startsWith(safeCode(code) + "."));
  if (!f) return null;
  const buf = fs.readFileSync(path.join(dir, f));
  return { buf, mime: sniffMime(buf, null).mime };
}
