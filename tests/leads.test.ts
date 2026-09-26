import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-leads-"));

describe("官网开户申请", () => {
  it("保存、计数、改状态；同一 IP 一小时最多 5 条", async () => {
    const leads = await import("@/lib/leads");
    const base = { company: "Test Store", contact: "Amy", phone: null, wechat: "amy", email: null, volume: null, note: null, lang: "zh" };
    for (let i = 0; i < 5; i++) leads.createLead({ ...base, company: `S${i}` }, "1.2.3.4");
    expect(() => leads.createLead(base, "1.2.3.4")).toThrow(/太频繁/);
    leads.createLead(base, "5.6.7.8");
    expect(leads.newLeadCount()).toBe(6);
    const first = leads.listLeads()[0];
    leads.updateLead(first.id, "contacted", "已加微信");
    expect(leads.listLeads()[0]).toMatchObject({ status: "contacted", adminNote: "已加微信" });
    expect(leads.newLeadCount()).toBe(5);
  });
});
