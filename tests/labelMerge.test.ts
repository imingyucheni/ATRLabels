import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atr-label-merge-"));
process.env.DATA_DIR = dir;
process.env.ATR_SINGLE_DB = "1";

/** 假的面单服务器：按地址返回不同格式的面单 */
function fakeLabels(files: Record<string, { body: Buffer; type: string }>) {
  vi.stubGlobal("fetch", async (url: string) => {
    const f = files[new URL(url).pathname];
    if (!f) return new Response("not found", { status: 404 });
    return new Response(new Uint8Array(f.body), { headers: { "content-type": f.type } });
  });
}

describe("多箱面单合成 PDF", () => {
  let labels: typeof import("@/lib/labels");
  let pdf: Buffer;
  const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(32)]);
  const zpl = Buffer.from("^XA^FO50,50^FDBOX 2^FS^XZ");

  beforeAll(async () => {
    labels = await import("@/lib/labels");
    pdf = labels.mockLabelPdf("BOX", { tracking: "1Z0001" });
  });
  afterEach(() => vi.unstubAllGlobals());

  const multi = (...paths: string[]) => `multi:${JSON.stringify(paths.map((p) => `http://labels.test${p}`))}`;
  const leftovers = () => fs.readdirSync(path.join(dir, "labels")).filter((f) => f.includes("-part"));

  it("每箱都是 PDF：合成一个 PDF，每箱一页", async () => {
    fakeLabels({ "/1.pdf": { body: pdf, type: "application/pdf" }, "/2.pdf": { body: pdf, type: "application/pdf" }, "/3.pdf": { body: pdf, type: "application/pdf" } });
    const r = await labels.downloadLabel(multi("/1.pdf", "/2.pdf", "/3.pdf"), "MB-OK");
    expect(r.mime).toBe("application/pdf");
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(labels.readLabel(r.path))).getPageCount()).toBe(3);
    expect(leftovers()).toEqual([]);
  });

  it("有一箱是 ZPL / GIF：报错说清楚第几箱、什么格式，不会合出一个少箱子的 PDF", async () => {
    fakeLabels({ "/1.pdf": { body: pdf, type: "application/pdf" }, "/2.zpl": { body: zpl, type: "text/plain" }, "/3.gif": { body: gif, type: "image/gif" } });
    await expect(labels.downloadLabel(multi("/1.pdf", "/2.zpl"), "MB-ZPL")).rejects.toThrow("多箱面单第 2 箱（共 2 箱）是 ZPL 格式，不能合成 PDF：请到服务商后台下载这票的全部面单");
    await expect(labels.downloadLabel(multi("/1.pdf", "/1.pdf", "/3.gif"), "MB-GIF")).rejects.toThrow(/第 3 箱（共 3 箱）是 GIF 格式/);
    // 没有留下合成到一半的面单，也没有留下单箱的临时文件
    const files = fs.readdirSync(path.join(dir, "labels"));
    expect(files.some((f) => f.startsWith("MB-ZPL") || f.startsWith("MB-GIF"))).toBe(false);
    expect(leftovers()).toEqual([]);
    const { translateMessage } = await import("@/lib/i18n");
    expect(translateMessage("en", "多箱面单第 2 箱（共 2 箱）是 ZPL 格式，不能合成 PDF：请到服务商后台下载这票的全部面单")).toBe(
      "Multi-box label for box 2 of 2 is in ZPL format and can't be merged into the PDF. Download all labels for this shipment from the provider's portal",
    );
  });
});
