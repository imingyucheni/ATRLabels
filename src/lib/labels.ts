import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./db";

function labelsDir() {
  const dir = path.join(dataDir(), "labels");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sniffMime(buf: Buffer, headerType: string | null): { mime: string; ext: string } {
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
    buf = mockLabelPdf(customNo);
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

/** 生成一张 4x6 英寸的模拟面单 PDF（仅模拟模式使用）。 */
export function mockLabelPdf(customNo: string): Buffer {
  const esc = (t: string) => t.replace(/[\\()]/g, (c) => "\\" + c);
  const lines = ["MOCK LABEL - NOT FOR SHIPPING", "4 x 6 in", `Ref: ${customNo}`, new Date().toISOString()];
  const content =
    "BT /F1 16 Tf 20 390 Td " +
    lines.map((l, i) => `${i ? "0 -28 Td " : ""}(${esc(l)}) Tj`).join(" ") +
    " ET 10 10 268 412 re S";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 288 432] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
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
