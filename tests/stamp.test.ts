import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-stamp-"));

describe("面单加印 SKU", async () => {
  const { DEFAULT_STAMP, stampLabelBytes, stampText } = await import("@/lib/stamp");
  const { mockLabelPdf } = await import("@/lib/labels");
  const sku = (s: string, q: number) => ({ sku: s, quantity: q }) as never;

  it("生成加印文字：SKU + 数量，单独填写的文字优先", () => {
    expect(stampText({ skuList: [sku("Buldak-RT-2pk*1", 1)], labelNote: null }, DEFAULT_STAMP)).toBe("SKU: Buldak-RT-2pk*1");
    expect(stampText({ skuList: [sku("A", 2), sku("B", 1)], labelNote: null }, DEFAULT_STAMP)).toBe("SKU: A x2 / B");
    expect(stampText({ skuList: [sku("A", 2)], labelNote: null }, { ...DEFAULT_STAMP, showQty: false, prefix: "" })).toBe("A");
    expect(stampText({ skuList: [sku("A", 1)], labelNote: "  客户要的文字 " }, DEFAULT_STAMP)).toBe("客户要的文字");
    expect(stampText({ skuList: [], labelNote: null }, DEFAULT_STAMP)).toBe("");
  });

  it("加印后仍是一页 4x6 PDF，文字写进了页面", async () => {
    const out = await stampLabelBytes(mockLabelPdf("X"), "application/pdf", "SKU: TEST-123", DEFAULT_STAMP);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({ width: 288, height: 432 });
    // 解压页面内容流，能找到写入的文字（pdf-lib 以十六进制写字符串）
    const hex = Buffer.from("SKU: TEST-123", "latin1").toString("hex").toUpperCase();
    const bin = Buffer.from(out);
    const texts: string[] = [];
    for (let i = bin.indexOf("stream"); i >= 0; i = bin.indexOf("stream", i + 6)) {
      const start = bin[i + 6] === 0x0d ? i + 8 : i + 7;
      const end = bin.indexOf("endstream", start);
      if (end < 0) break;
      const chunk = bin.subarray(start, end);
      try { texts.push(inflateSync(chunk).toString("latin1")); } catch { texts.push(chunk.toString("latin1")); }
      i = end;
    }
    expect(texts.some((t) => t.toUpperCase().includes(hex) || t.includes("SKU: TEST-123"))).toBe(true);
  });

  it("长文字自动换行 / 缩小；中文替换成 ?；各种旋转角度都能生成", async () => {
    const long = "SKU: " + Array.from({ length: 12 }, (_, i) => `PRODUCT-CODE-${i}`).join(" / ");
    for (const rotate of [0, 90, 180, 270] as const) {
      const out = await stampLabelBytes(mockLabelPdf("X"), "application/pdf", long + " 面条", { ...DEFAULT_STAMP, rotate });
      expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
    }
  });

  it("PNG 面单会转成 4x6 PDF 再加印", async () => {
    // 1x1 白色 PNG
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");
    const out = await stampLabelBytes(png, "image/png", "SKU: PNG", DEFAULT_STAMP);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).getSize()).toEqual({ width: 288, height: 432 });
  });

  it("各渠道示例面单：上传后可读取，只接受 PDF / 图片", async () => {
    const { saveChannelSample, readChannelSample } = await import("@/lib/labels");
    expect(readChannelSample("LP10210028")).toBeNull();
    saveChannelSample("LP10210028", mockLabelPdf("S"));
    expect(readChannelSample("LP10210028")!.mime).toBe("application/pdf");
    expect(() => saveChannelSample("LP10210028", Buffer.from("hello"))).toThrow(/PDF、PNG/);
  });

  it("USPS 渠道同步时自动套用加印预设，其他渠道不加印", async () => {
    const db = await import("@/lib/db");
    db.upsertChannels([{ code: "LP10210030", name: "USPS-（91710）" }, { code: "LP10210028", name: "UniUni-（91710）" }]);
    expect(db.getChannel("LP10210030")!.stamp).toMatchObject({ enabled: true, y: 5.45 });
    expect(db.getChannel("LP10210028")!.stamp).toBeNull();
    // 已经手动设置过的不会被覆盖
    db.setChannelStamp("LP10210030", { enabled: true, y: 4.9 });
    db.upsertChannels([{ code: "LP10210030", name: "USPS-（91710）" }]);
    expect(db.getChannel("LP10210030")!.stamp!.y).toBe(4.9);
  });
});

describe("面单纸张排版", () => {
  it("4x6 原样；半张 / 整张 / 每页两张", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const { layoutLabels } = await import("@/lib/labelLayout");
    const src = await PDFDocument.create();
    for (let i = 0; i < 3; i++) src.addPage([288, 432]).drawRectangle({ x: 10, y: 10, width: 268, height: 412, borderWidth: 1 });
    const three = await src.save();
    expect(await layoutLabels(three, "4x6")).toBe(three);
    const half = await PDFDocument.load(await layoutLabels(three, "half"));
    expect(half.getPageCount()).toBe(3);
    expect(half.getPage(0).getSize()).toEqual({ width: 612, height: 396 });
    const letter = await PDFDocument.load(await layoutLabels(three, "letter"));
    expect(letter.getPageCount()).toBe(3);
    expect(letter.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    const two = await PDFDocument.load(await layoutLabels(three, "letter2"));
    expect(two.getPageCount()).toBe(2); // 3 张 → 2 页
  });
});
