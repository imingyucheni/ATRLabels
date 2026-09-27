import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { detectLabelSku, skuOnLabel } from "@/lib/labelSku";

async function pdfWith(lines: string[]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([288, 432]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((l, i) => page.drawText(l, { x: 10, y: 400 - i * 14, size: 10, font }));
  return Buffer.from(await doc.save());
}

describe("面单是否自带 SKU", () => {
  const body = "SHIP TO JANE ROE 2 ELM ST AUSTIN TX 78701 USPS GROUND ADVANTAGE 9400 1000 0000 0000 0000 00";

  it("按文字判断：有 / 没有 / 图片面单", () => {
    expect(skuOnLabel(`${body} Remarks: TSHIRT-RED-L*2`, ["TSHIRT-RED-L"])).toBe("yes");
    expect(skuOnLabel(`${body} Remarks: tshirt - red - l`, ["TSHIRT-RED-L"])).toBe("yes"); // 不分大小写、忽略空格
    expect(skuOnLabel(`${body} Remarks: TSHIRT_RED_L`, ["TSHIRT-RED-L"])).toBe("no"); // 字符不同不算
    expect(skuOnLabel(`${body} Remarks: TSHIRT RED L`, ["TSHIRTRED L"])).toBe("yes"); // 忽略空格
    expect(skuOnLabel(body, ["TSHIRT-RED-L"])).toBe("no");
    expect(skuOnLabel("  ", ["TSHIRT-RED-L"])).toBe("image");
    // 很短的 SKU 要求独立出现，不能是别的词的一部分
    expect(skuOnLabel(`${body} SKU: A1 x2`, ["A1"])).toBe("yes");
    expect(skuOnLabel(`${body} ZONE A12`, ["A1"])).toBe("no");
    // 多个 SKU 有一个出现就算
    expect(skuOnLabel(`${body} B-2000`, ["A-1000", "B-2000"])).toBe("yes");
  });

  it("读取真实 PDF 的文字", async () => {
    const skus = ["ABC-12345"];
    expect(await detectLabelSku(await pdfWith([body, "SKU: ABC-12345 x2"]), "application/pdf", skus)).toBe("yes");
    expect(await detectLabelSku(await pdfWith([body]), "application/pdf", skus)).toBe("no");
    expect(await detectLabelSku(await pdfWith([]), "application/pdf", skus)).toBe("image"); // 没有文字层
    expect(await detectLabelSku(Buffer.from("not a pdf"), "application/pdf", skus)).toBe("image");
    expect(await detectLabelSku(Buffer.from([0x89]), "image/png", skus)).toBe("image");
  });
});
