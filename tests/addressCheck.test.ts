import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-addr-"));
process.env.SHIPBEST_MOCK = "1";

describe("收件地址核对", async () => {
  const { interpretUsps, checkAddress, needsAck } = await import("@/lib/addressCheck");
  const input = { address1: "500 congress avenue", city: "austin", province: "TX", zipCode: "78701" };

  it("解析 USPS 返回", () => {
    const ok = interpretUsps(input, { address: { streetAddress: "500 congress avenue", city: "austin", state: "TX", ZIPCode: "78701" }, additionalInfo: { DPVConfirmation: "Y", business: "Y" } });
    expect(ok.status).toBe("ok");
    expect(ok.business).toBe(true);
    const fixed = interpretUsps(input, { address: { streetAddress: "500 CONGRESS AVE", city: "AUSTIN", state: "TX", ZIPCode: "78701", ZIPPlus4: "3702" }, additionalInfo: { DPVConfirmation: "Y" } });
    expect(fixed.status).toBe("corrected");
    expect(fixed.suggestion?.zipCode).toBe("78701-3702");
    expect(interpretUsps(input, { additionalInfo: { DPVConfirmation: "D" } }).status).toBe("missing_unit");
    expect(interpretUsps(input, { additionalInfo: { DPVConfirmation: "S" } }).status).toBe("bad_unit");
    expect(interpretUsps(input, { additionalInfo: { DPVConfirmation: "N" } }).status).toBe("not_found");
    expect(needsAck({ status: "not_found" })).toBe(true);
    expect(needsAck({ status: "corrected" })).toBe(false);
  });

  it("没配置 USPS 时：模拟模式用规则模拟，非美国地址跳过", async () => {
    expect((await checkAddress({ ...input, country: "US", address1: "500 Congress Ave" })).status).toBe("ok");
    expect((await checkAddress({ ...input, country: "US", address1: "500 Congress Avenue" })).status).toBe("corrected");
    expect((await checkAddress({ ...input, country: "US", address1: "Nowhere Road" })).status).toBe("not_found");
    expect((await checkAddress({ ...input, country: "CA" })).status).toBe("skipped");
  });
});
