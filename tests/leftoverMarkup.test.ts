import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-leftover-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

describe("活动结束后遗留的负数加价", () => {
  let db: typeof import("@/lib/db");
  let mk: typeof import("@/lib/markup");
  let codes: string[];
  const cust = (name: string, percent: number | null = null) => db.saveCustomer(null, { name, contact: null, phone: null, email: null, note: null, markup: { percent } });

  beforeAll(async () => {
    db = await import("@/lib/db");
    mk = await import("@/lib/markup");
    const svc = await import("@/lib/service");
    await svc.syncChannels();
    codes = db.listChannels().filter((c) => !/HWT|MWT/.test(c.name)).map((c) => c.code);
    db.saveSettings({ markup: { percent: 10, fixed: 0, minProfit: 0 } });
  });

  it("找出还在生效的负数加价，恢复成改之前的设置；已经调回的、在长期返利范围内的不动", () => {
    const [ontrac, other] = codes;
    // A：活动前 +8%，活动期间被改成 -15% → 恢复成 +8%
    const a = cust("客户 A");
    mk.setCustomerChannelMarkups(a, { [ontrac]: { percent: 8 } });
    mk.setCustomerChannelMarkups(a, { [ontrac]: { percent: -15, fixed: 0.2 } });
    // B：原来沿用，活动期间填了 -15% → 清空，沿用客户专属 +6%
    const b = cust("客户 B", 6);
    mk.setCustomerChannelMarkups(b, { [ontrac]: { percent: -15 } });
    // C：已经调回 +5% → 不动
    const c = cust("客户 C");
    mk.setCustomerChannelMarkups(c, { [ontrac]: { percent: -15 } });
    mk.setCustomerChannelMarkups(c, { [ontrac]: { percent: 5 } });
    // D：渠道有长期返利 30%，-10% 是正常设置 → 不动
    db.setChannelRebate(other, 30);
    const d = cust("客户 D");
    mk.setCustomerChannelMarkups(d, { [other]: { percent: -10 } });

    const list = mk.leftoverNegativeMarkups();
    expect(list.map((x) => x.customerName).sort()).toEqual(["客户 A", "客户 B"]);
    expect(list.find((x) => x.customerId === a)).toMatchObject({ restorePercent: 8, restoreEffective: 8 });
    expect(list.find((x) => x.customerId === b)).toMatchObject({ restorePercent: null, restoreEffective: 6 });
    expect(mk.effectiveRule(a, ontrac).percent).toBe(-15);

    expect(mk.restoreLeftoverNegativeMarkups()).toBe(2);
    expect(mk.effectiveRule(a, ontrac)).toMatchObject({ percent: 8, fixed: 0.2, source: "customer_channel" });
    expect(mk.effectiveRule(b, ontrac)).toMatchObject({ percent: 6, source: "customer" });
    expect(mk.effectiveRule(c, ontrac).percent).toBe(5);
    expect(mk.effectiveRule(d, other).percent).toBe(-10);
    expect(mk.leftoverNegativeMarkups()).toEqual([]);
    // 恢复也记在修改记录里
    expect(mk.listMarkupLog({ customerId: a })[0]).toMatchObject({ before: { percent: -15 }, after: { percent: 8 } });
    expect(mk.restoreLeftoverNegativeMarkups()).toBe(0);
  });

  it("渠道加价被改成负数（没有长期返利）也会找出来", () => {
    const ch = codes[2];
    db.updateChannel(ch, true, { percent: 3 });
    mk.logMarkupChange({ scope: "channel", channelCode: ch, label: "x", before: null, after: { percent: 3 } });
    mk.logMarkupChange({ scope: "channel", channelCode: ch, label: "x", before: { percent: 3 }, after: { percent: -12 } });
    db.updateChannel(ch, true, { percent: -12 });
    expect(mk.leftoverNegativeMarkups()).toMatchObject([{ scope: "channel", channelCode: ch, restorePercent: 3 }]);
    mk.restoreLeftoverNegativeMarkups();
    expect(db.getChannel(ch)?.markup?.percent).toBe(3);
  });
});
