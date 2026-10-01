import { describe, expect, it } from "vitest";
import { hoursToEnglish } from "@/lib/hoursText";

describe("营业时间自动转英文", () => {
  it("常见写法", () => {
    expect(hoursToEnglish("周一至周五 9:00–18:00（美西时间）")).toBe("Mon–Fri 9:00–18:00 (Pacific Time)");
    expect(hoursToEnglish("周一至周六 9:00–18:00（美西时间）")).toBe("Mon–Sat 9:00–18:00 (Pacific Time)");
    expect(hoursToEnglish("星期一到星期五 9:00-17:00，节假日休息")).toBe("Mon–Fri 9:00-17:00, closed on holidays");
    expect(hoursToEnglish("周一至周五 9:00–18:00；周六 10:00–14:00")).toBe("Mon–Fri 9:00–18:00, Sat 10:00–14:00");
  });
});
