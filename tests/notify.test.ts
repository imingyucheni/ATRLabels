import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-notify-"));

describe("邮件通知设置", async () => {
  const db = await import("@/lib/db");
  const n = await import("@/lib/notify");
  it("默认全部开启；可以逐项关闭；退订链接要签名正确", () => {
    const id = db.saveCustomer(null, { name: "通知客户", contact: null, phone: null, email: null, note: null, markup: {} });
    expect(n.getNotifyPrefs(id).events.topup).toBe(true);
    const p = n.getNotifyPrefs(id);
    p.events.adjustment = false;
    n.saveNotifyPrefs(id, p);
    expect(n.getNotifyPrefs(id).events.adjustment).toBe(false);
    expect(n.unsubscribe(id, "lowBalance", "wrong-signature-xxxxxxxx")).toBe(false);
    const url = new URL(n.unsubscribeUrl(id, "lowBalance"), "http://x");
    expect(n.unsubscribe(id, "lowBalance", url.searchParams.get("s")!)).toBe(true);
    expect(n.getNotifyPrefs(id).events.lowBalance).toBe(false);
    expect(n.getNotifyPrefs(id).events.topup).toBe(true);
  });
  it("没配置发件邮箱时不发", () => {
    expect(n.notifyReady()).toBe(false);
  });
});
