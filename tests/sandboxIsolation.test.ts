import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-iso-"));
delete process.env.ATR_SINGLE_DB;
delete process.env.SHIPBEST_MOCK;

describe("正式站和沙盒站隔离", () => {
  afterEach(() => {
    delete process.env.APP_ENV;
  });

  it("正式站：就算留着以前的测试模式记录，也只用正式数据、正式模式", async () => {
    const db = await import("@/lib/db");
    const client = await import("@/lib/shipbest/client");
    db.setStoredMode("sandbox");
    expect(db.currentEnv()).toBe("test"); // 老的单站模式：会切到测试数据
    process.env.APP_ENV = "production";
    expect(db.currentEnv()).toBe("live");
    db.saveSettings({ shipbest: { mode: "sandbox", apiId: "fake-id", token: "fake-token" } });
    expect(client.shipbestConfig().mode).toBe("live");
    // 还没填任何服务商账号：模拟（刚装好试看）
    db.saveSettings({ shipbest: { mode: "sandbox", apiId: "", token: "" } });
    expect(client.shipbestConfig().mode).toBe("mock");
  });

  it("沙盒站：不发邮件、清空只在沙盒站可用，清空后客户和设置保留", async () => {
    const db = await import("@/lib/db");
    const { resetSandboxData } = await import("@/lib/cleanup");
    const { sendMail } = await import("@/lib/mailer");
    expect(() => resetSandboxData()).toThrow(/只有沙盒站/);
    process.env.APP_ENV = "sandbox";
    await expect(sendMail("a@b.com", "x", "y")).rejects.toThrow(/沙盒站不发送邮件/);
    const cid = db.saveCustomer(null, { name: "沙盒客户", contact: null, phone: null, email: null, note: null, markup: {} });
    const addr = { nameFirst: "A", nameLast: "B", country: "US", city: "LA", address1: "1 Main", zipCode: "90058", province: "CA" };
    db.insertShipment({
      customNo: "SBX-1", customerId: cid, channelCode: "LP-UNI", channelName: "UNI", sender: addr, recipient: addr,
      pkg: { length: 1, width: 1, height: 1, weight: 1, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
      skuList: [], quotedCost: 3, currency: "USD", zone: null, price: 4, rule: { percent: 0, fixed: 1, minProfit: 0 }, remark: null, customerRef: null, createdBy: "admin", env: "sandbox", addressCheck: null,
    });
    expect(resetSandboxData().shipments).toBe(1);
    expect(db.listShipments({})).toHaveLength(0);
    expect(db.getCustomer(cid)?.name).toBe("沙盒客户");
  });
});
