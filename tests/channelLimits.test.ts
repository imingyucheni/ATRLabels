import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-limits-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

const pkg = (l: number, w: number, h: number, weight: number, u: 1 | 2 | 3 = 3): ShipmentRequest => ({
  sender: { nameFirst: "A", nameLast: "B", country: "US", city: "Chino", address1: "1 Main", zipCode: "91710", province: "CA" },
  recipient: { nameFirst: "C", nameLast: "D", country: "US", city: "West Bend", address1: "529 S 8th Ave", zipCode: "53095", province: "WI" },
  pkg: { length: l, width: w, height: h, weight, displayUnitSystem: u, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [],
});

describe("渠道重量 / 尺寸限制", () => {
  let lim: typeof import("@/lib/channelLimits");
  beforeAll(async () => {
    const db = await import("@/lib/db");
    lim = await import("@/lib/channelLimits");
    db.upsertChannels([{ code: "JG-579181", name: "GOFO-LAX-917(不预上网) · GDE" }, { code: "JG-580914", name: "USPS-D价 · GDE" }, { code: "LP-GOFO", name: "GOFO-（91710） · SB" }]);
  });

  it("GDE 的 GOFO：默认计费重 20 磅、最长边 90cm、三边和 150cm；按 DIM 166 算体积重", () => {
    expect(lim.checkLimits("JG-579181", pkg(12, 10, 8, 5))).toBeNull();
    expect(lim.checkLimits("JG-579181", pkg(12, 10, 8, 21))).toMatch(/重量限制.*上限 20 lb/);
    expect(lim.checkLimits("JG-579181", pkg(20, 16, 12, 3))).toMatch(/计费重量 23.1 lb.*材积系数 166/); // 体积重 23.1 lb
    expect(lim.checkLimits("JG-579181", pkg(95, 20, 10, 1, 1))).toMatch(/最长边/); // 95cm
    expect(lim.checkLimits("JG-579181", pkg(60, 50, 45, 1, 1))).toMatch(/长宽高之和/);
    // 没有默认限制的渠道不检查
    expect(lim.checkLimits("JG-580914", pkg(40, 30, 30, 60))).toBeNull(); // 嘉谷 USPS 没有默认限制
    // ShipBest 的 GOFO：20 磅、单边 60cm
    expect(lim.checkLimits("LP-GOFO", pkg(12, 10, 8, 19))).toBeNull();
    expect(lim.checkLimits("LP-GOFO", pkg(12, 10, 8, 21))).toMatch(/上限 20 lb/);
    expect(lim.checkLimits("LP-GOFO", pkg(70, 20, 10, 1, 1))).toMatch(/最长边/);
  });

  it("后台可以改；客户只看到简短原因", async () => {
    lim.saveLimits("JG-579181", { maxLb: 30, divisor: 166 });
    expect(lim.checkLimits("JG-579181", pkg(12, 10, 8, 21))).toBeNull();
    lim.saveLimits("JG-579181", null);
    const { publicQuoteError } = await import("@/lib/portal");
    expect(publicQuoteError(lim.checkLimits("JG-579181", pkg(12, 10, 8, 21)))).toBe("不支持该重量或地区");
    expect(publicQuoteError(lim.checkLimits("JG-579181", pkg(95, 20, 10, 1, 1)))).toBe("超出尺寸范围：这个渠道不支持该包裹尺寸");
  });

  it("包裹太小：只提醒不拦单；默认 15 × 10 cm，可以改或关掉", async () => {
    expect(lim.checkMinSize("JG-579181", pkg(8, 6, 2, 1))).toBeNull();
    expect(lim.checkMinSize("JG-579181", pkg(4, 3, 1, 0.5))).toMatch(/包裹偏小：最长边 4 in、第二长边 3 in.*5.9 × 3.9 in（约 15 × 10 cm）/);
    expect(lim.checkMinSize("JG-579181", pkg(12, 8, 1, 1, 1))).toMatch(/包裹偏小/); // 12 × 8 cm
    expect(lim.checkLimits("JG-579181", pkg(4, 3, 1, 0.5))).toBeNull(); // 不拦单
    lim.saveLimits("LP-GOFO", { maxLb: 20, minLongestIn: 0, minSecondIn: 0 });
    expect(lim.checkMinSize("LP-GOFO", pkg(4, 3, 1, 0.5))).toBeNull(); // 0 = 不提醒
    const { translateMessage } = await import("@/lib/i18n");
    expect(translateMessage("en", lim.checkMinSize("JG-579181", pkg(4, 3, 1, 0.5)))).toMatch(/^Package is small: longest side 4 in/);
  });
});
