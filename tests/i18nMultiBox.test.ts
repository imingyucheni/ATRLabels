import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { translate, translateMessage } from "@/lib/i18n";
import { checkMultiBox, MULTI_BOX_RULES, multiBoxRule, multiBoxWarnings, type Piece } from "@/lib/multiBox";

const CJK = /[一-鿿]/;
const en = (m: string) => translateMessage("en", m);
const hwt = multiBoxRule("UPS-NEW-HWT-XT · GDE")!;
const mwt = multiBoxRule("Fedex MWT末端-W · GDE")!;
const box = (length: number, width: number, height: number, weight: number, qty: number): Piece => ({ length, width, height, weight, qty });

describe("多箱寄出的英文界面", () => {
  it("嘉谷的 FedEx MWT 渠道名能认出来", () => {
    expect(mwt.id).toBe("fedex-mwt");
    expect(hwt.id).toBe("ups-hwt");
  });

  it("下单要求都有英文", () => {
    for (const r of MULTI_BOX_RULES) for (const n of r.notes) expect(translate("en", n), n).not.toMatch(CJK);
  });

  it("检查提示（带数字、带具体原因）都翻成英文", () => {
    const msgs = [
      ...checkMultiBox(hwt, [box(10, 10, 10, 10, 1)]),
      ...checkMultiBox(hwt, [box(20, 20, 20, 60, 5)]),
      ...checkMultiBox(hwt, [box(50, 20, 20, 30, 10)]),
      ...checkMultiBox(hwt, [box(30, 25, 20, 45, 2)]),
      ...checkMultiBox(hwt, [box(12, 12, 12, 45, 50)]),
      ...checkMultiBox(hwt, [box(30, 20, 10, 45, 5)], [{ productNameEn: "", hsCode: "" }], { forOrder: true }),
      ...checkMultiBox(hwt, [box(30, 20, 10, 45, 5)], [{ productNameEn: "衣服", hsCode: "6109" }, { productNameEn: "", hsCode: "" }], { forOrder: true }),
      ...checkMultiBox(mwt, [box(20, 20, 20, 40, 6)], [], { state: "AK" }),
      ...checkMultiBox(mwt, [box(120, 10, 10, 40, 6)]),
      ...checkMultiBox(mwt, [box(20, 20, 20, 160, 6)]),
      ...checkMultiBox(mwt, [box(0, 0, 0, 0, 0)]),
      ...multiBoxWarnings(mwt, [box(50, 20, 10, 40, 4), box(60, 30, 20, 60, 2)]),
      ...multiBoxWarnings(mwt, [box(20, 20, 20, 120, 3)]),
    ];
    expect(msgs.length).toBeGreaterThan(12);
    for (const m of msgs) expect(en(m), m).not.toMatch(CJK);
    // 几条连在一起的（报价提醒、出单报错）也逐条翻译
    expect(en(msgs.slice(0, 3).join("；"))).not.toMatch(CJK);
    expect(en("UPS HWT 至少 2 箱一起下单（现在 1 箱）")).toBe("UPS HWT needs at least 2 boxes in one shipment (currently 1)");
  });

  it("多箱页面上的文字都有英文", () => {
    const files = [
      "src/components/MultiBoxForm.tsx",
      "src/components/PiecesInfo.tsx",
      "src/app/(admin)/customers/[id]/MultiAccessCard.tsx",
      "src/app/(admin)/ship/multi/page.tsx",
      "src/app/portal/(app)/multi/page.tsx",
    ];
    const missing: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
      for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) {
        const key = m[1];
        if (CJK.test(key) && CJK.test(translate("en", key))) missing.push(`${f}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
