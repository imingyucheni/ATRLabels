import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-pin-"));

describe("财务确认密码", async () => {
  const { checkFinancePin, setFinancePin, hasFinancePin } = await import("@/lib/financePin");
  it("没设置时不能确认；只接受 4 位数字；输错 5 次锁定", () => {
    expect(hasFinancePin()).toBe(false);
    expect(checkFinancePin("1234")).toMatch(/请先/);
    expect(() => setFinancePin("12a4")).toThrow(/4 位数字/);
    setFinancePin("2580");
    expect(checkFinancePin("2580")).toBeNull();
    expect(checkFinancePin("0000")).toMatch(/还可以再试 4 次/);
    for (let i = 0; i < 3; i++) checkFinancePin("0000");
    expect(checkFinancePin("0000")).toMatch(/30 分钟/);
    expect(checkFinancePin("2580")).toMatch(/30 分钟/); // 锁定期间正确密码也不行
  });
});
