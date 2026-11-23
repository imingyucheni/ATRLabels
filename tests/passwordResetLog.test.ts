import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-pwreset-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

const S = vi.hoisted(() => ({ smtp: true, fail: null as string | null, mails: [] as { to: string; subject: string; text: string }[] }));
// 不连真实邮件服务器：记下要发的邮件；fail 有值时模拟发送失败
vi.mock("@/lib/mailer", async (orig) => ({
  ...(await orig<typeof import("@/lib/mailer")>()),
  smtpConfigured: () => S.smtp,
  sendMail: async (to: string, subject: string, text: string) => {
    if (S.fail) throw new Error(S.fail);
    S.mails.push({ to, subject, text });
  },
}));

describe("忘记密码：每次申请都有记录，没发出去的交给客服、可以再申请", () => {
  let db: typeof import("@/lib/db");
  let pr: typeof import("@/lib/passwordReset");
  let cid: number;
  const BASE = "https://oms.example.test";

  beforeAll(async () => {
    db = await import("@/lib/db");
    pr = await import("@/lib/passwordReset");
    cid = db.saveCustomer(null, { name: "重置客户", contact: null, phone: null, email: "contact@example.test", note: null, markup: {} });
    db.updateCustomerPortal(cid, { email: "login@example.test", enabled: true, creditLimit: 0 });
  });

  it("发送失败：告诉客户客服会处理，申请进后台；发信记录里有失败原因；可以马上再申请", async () => {
    S.fail = "535 Authentication failed";
    expect(await pr.requestReset("login@example.test", BASE, "198.51.100.1")).toEqual({ emailed: false });
    expect(pr.recentResetAttempts(1)[0]).toMatchObject({ email: "login@example.test", customerId: cid, customerName: "重置客户", outcome: "failed", error: "535 Authentication failed" });
    expect(pr.pendingResets().map((x) => x.customer_id)).toEqual([cid]);
    const { recentEmailLog } = await import("@/lib/notify");
    expect(recentEmailLog(1)[0]).toMatchObject({ event: "password_reset", to_email: "login@example.test", status: "failed", error: "535 Authentication failed" });
    // 邮箱修好后客户再点一次：不被“10 分钟内只处理一次”挡住，这次发出去了
    S.fail = null;
    expect(await pr.requestReset("login@example.test", BASE)).toEqual({ emailed: true });
    expect(S.mails).toHaveLength(1);
    expect(S.mails[0].text).toContain(`${BASE}/portal/reset?token=`);
    expect(S.mails[0].subject).toMatch(/重置密码 \/ Reset your password/);
    expect(pr.recentResetAttempts(1)[0].outcome).toBe("emailed");
    expect(recentEmailLog(1)[0]).toMatchObject({ event: "password_reset", status: "sent" });
    // 发出去之后 10 分钟内再点：不再发，记成重复
    expect(await pr.requestReset("login@example.test", BASE)).toEqual({ emailed: true });
    expect(S.mails).toHaveLength(1);
    expect(pr.recentResetAttempts(1)[0].outcome).toBe("duplicate");
    // 同一客户的待处理申请只列一条
    expect(pr.pendingResets().filter((x) => x.customer_id === cid)).toHaveLength(1);
  });

  it("填错邮箱（联系邮箱不是登录邮箱）、没开通登录、没配置网址、没配置发件邮箱：都记下来，后台看得出原因", async () => {
    db.db().prepare("DELETE FROM password_resets").run();
    expect(await pr.requestReset("contact@example.test", BASE)).toEqual({ emailed: true }); // 回复和存在的邮箱一样
    expect(pr.recentResetAttempts(1)[0]).toMatchObject({ email: "contact@example.test", customerId: null, outcome: "no_account" });
    expect(await pr.requestReset("login@example.test", null)).toEqual({ emailed: false });
    expect(pr.recentResetAttempts(1)[0]).toMatchObject({ outcome: "no_url", error: expect.stringMatching(/APP_URL/) });
    S.smtp = false;
    db.db().prepare("DELETE FROM password_resets").run();
    expect(await pr.requestReset("login@example.test", BASE)).toEqual({ emailed: false });
    expect(pr.recentResetAttempts(1)[0].outcome).toBe("manual");
    db.updateCustomerPortal(cid, { email: "login@example.test", enabled: false, creditLimit: 0 });
    await pr.requestReset("login@example.test", BASE);
    expect(pr.recentResetAttempts(1)[0]).toMatchObject({ customerId: cid, outcome: "disabled" });
    expect(pr.RESET_OUTCOME_LABEL[pr.recentResetAttempts(1)[0].outcome]).toBe("这个账号没有开通登录");
    S.smtp = true;
  });
});
