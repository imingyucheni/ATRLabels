import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-addr-"));
process.env.SHIPBEST_MOCK = "1";

describe("收件地址核对", async () => {
  const { interpretUsps, interpretGoogle, checkAddress, needsAck } = await import("@/lib/addressCheck");
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

  it("解析 Google 返回", () => {
    const std = { firstAddressLine: "500 CONGRESS AVE", city: "AUSTIN", state: "TX", zipCode: "78701", zipCodeExtension: "3702" };
    const ok = interpretGoogle({ ...input, address1: "500 CONGRESS AVE", city: "AUSTIN" }, { verdict: { validationGranularity: "PREMISE" }, uspsData: { standardizedAddress: { ...std, zipCodeExtension: undefined }, dpvConfirmation: "Y" }, metadata: { business: true } });
    expect(ok.status).toBe("ok");
    expect(ok.business).toBe(true);
    const fixed = interpretGoogle(input, { verdict: { validationGranularity: "PREMISE" }, uspsData: { standardizedAddress: std, dpvConfirmation: "Y" }, metadata: { residential: true } });
    expect(fixed.status).toBe("corrected");
    expect(fixed.suggestion?.address1).toBe("500 CONGRESS AVE");
    expect(fixed.business).toBe(false);
    expect(interpretGoogle(input, { uspsData: { dpvConfirmation: "D" } }).status).toBe("missing_unit");
    expect(interpretGoogle(input, { verdict: { possibleNextAction: "CONFIRM_ADD_SUBPREMISES", validationGranularity: "PREMISE" } }).status).toBe("missing_unit");
    expect(interpretGoogle(input, { uspsData: { dpvConfirmation: "N" } }).status).toBe("not_found");
    expect(interpretGoogle(input, { verdict: { validationGranularity: "ROUTE", possibleNextAction: "FIX" } }).status).toBe("not_found");
  });

  it("每月上限：用完就不再查", async () => {
    const db = await import("@/lib/db");
    const { monthlyUsage } = await import("@/lib/addressCheck");
    db.saveSettings({ addrCheck: { enabled: true, provider: "google", googleKey: "test-key", monthlyCap: 1 } });
    db.db().exec("CREATE TABLE IF NOT EXISTS address_usage (month TEXT NOT NULL, provider TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (month, provider))");
    db.db().prepare("INSERT OR REPLACE INTO address_usage (month, provider, count) VALUES (?, 'google', 1)").run(new Date().toISOString().slice(0, 7));
    expect(monthlyUsage("google")).toBe(1);
    const r = await checkAddress({ country: "US", address1: "1 New St", city: "Austin", province: "TX", zipCode: "78701" });
    expect(r.status).toBe("unavailable");
    expect(r.message).toMatch(/已用完/);
    db.saveSettings({ addrCheck: { enabled: true, provider: "google", googleKey: "", monthlyCap: 5000 } });
  });

  it("没配置 USPS 时：模拟模式用规则模拟，非美国地址跳过", async () => {
    expect((await checkAddress({ ...input, country: "US", address1: "500 Congress Ave" })).status).toBe("ok");
    expect((await checkAddress({ ...input, country: "US", address1: "500 Congress Avenue" })).status).toBe("corrected");
    expect((await checkAddress({ ...input, country: "US", address1: "Nowhere Road" })).status).toBe("not_found");
    expect((await checkAddress({ ...input, country: "CA" })).status).toBe("skipped");
  });
});
