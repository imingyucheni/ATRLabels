import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-staff-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";
process.env.SESSION_SECRET = "test-secret-1234567890";
process.env.ADMIN_PASSWORD = "pw-1234";

describe("员工账号（二级管理员）", () => {
  let st: typeof import("@/lib/staffStore");
  let ses: typeof import("@/lib/adminSession");
  let pin: typeof import("@/lib/financePin");
  let actor: typeof import("@/lib/actor");
  let amy: number;
  beforeAll(async () => {
    st = await import("@/lib/staffStore");
    ses = await import("@/lib/adminSession");
    pin = await import("@/lib/financePin");
    actor = await import("@/lib/actor");
  });

  it("创建：登录名格式、不能重复、admin 保留、密码至少 8 位；密码只存哈希", () => {
    expect(() => st.createStaff({ name: "A", username: "a", password: "12345678" })).toThrow(/登录名/);
    expect(() => st.createStaff({ name: "A", username: "admin", password: "12345678" })).toThrow(/保留/);
    expect(() => st.createStaff({ name: "A", username: "amy", password: "123" })).toThrow(/8 位/);
    amy = st.createStaff({ name: "Amy", username: "Amy", password: "amy-pass-1" });
    expect(() => st.createStaff({ name: "B", username: "amy", password: "12345678" })).toThrow(/已经有人用/);
    const raw = fs.readFileSync(path.join(process.env.DATA_DIR!, "staff.json"), "utf8");
    expect(raw).not.toContain("amy-pass-1");
    expect(st.listStaff()[0]).toMatchObject({ username: "amy", hasPin: false, active: true });
    expect(JSON.stringify(st.listStaff())).not.toContain("scrypt");
  });

  it("登录和会话：密码对才能登录；停用 / 改密码后旧会话失效", () => {
    expect(st.staffLogin("amy", "wrong-pass")).toBeNull();
    expect(st.staffLogin("nobody", "amy-pass-1")).toBeNull();
    const s = st.staffLogin("AMY", "amy-pass-1")!;
    expect(s.lastLoginAt).toBeTruthy();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const tok = ses.staffToken(s.id, s.ver, exp);
    expect(ses.verifySession(tok)).toMatchObject({ role: "staff", id: amy, name: "Amy" });
    expect(ses.verifyAdminToken(tok)).toBe(false); // 员工不是主管理员
    expect(ses.verifySession(tok.replace(/.$/, (c) => (c === "0" ? "1" : "0")))).toBeNull(); // 改签名
    st.setStaffPassword(amy, "new-pass-22");
    expect(ses.verifySession(tok)).toBeNull();
    const s2 = st.staffLogin("amy", "new-pass-22")!;
    const tok2 = ses.staffToken(s2.id, s2.ver, exp);
    st.setStaffActive(amy, false);
    expect(ses.verifySession(tok2)).toBeNull();
    expect(st.staffLogin("amy", "new-pass-22")).toBeNull();
    st.setStaffActive(amy, true);
    // 主管理员令牌
    expect(ses.verifySession(`${exp}.${ses.adminMac(exp)}`)).toMatchObject({ role: "owner", name: "主管理员" });
  });

  it("员工能开的页面：客户、咨询、试算、财务、我的账号；其他不行", () => {
    for (const p of ["/customers", "/customers/3", "/customers/3/statement", "/leads", "/quote", "/finance", "/account"]) expect(ses.staffCanOpen(p), p).toBe(true);
    for (const p of ["/", "/reports", "/shipments", "/shipments/1", "/settings", "/backups", "/commissions", "/staff", "/ship", "/reconcile", "/adjustments", "/coverage", "/customersx"]) expect(ses.staffCanOpen(p), p).toBe(false);
  });

  it("确认密码：员工用自己的 4 位密码，没设置时提示去设置，输错有次数限制", () => {
    const who = { role: "staff" as const, id: amy };
    expect(pin.checkConfirmPin(who, "1234")).toMatch(/我的账号/);
    expect(() => st.setStaffPin(amy, "12a4")).toThrow(/4 位数字/);
    st.setStaffPin(amy, "2468");
    expect(pin.checkConfirmPin(who, "2468")).toBeNull();
    for (let i = 0; i < 4; i++) expect(pin.checkConfirmPin(who, "0000")).toMatch(/不正确/);
    expect(pin.checkConfirmPin(who, "0000")).toMatch(/过多/);
    expect(pin.checkConfirmPin(who, "2468")).toMatch(/过多/); // 锁定期间对的也不行
    // 主管理员还是用设置里的财务确认密码
    expect(pin.checkConfirmPin({ role: "owner", id: 0 }, "2468")).toMatch(/设置/);
  });

  it("充值确认记录确认人：主管理员 / 员工名字", async () => {
    const db = await import("@/lib/db");
    const topup = await import("@/lib/topup");
    const ledger = await import("@/lib/ledger");
    const cid = db.saveCustomer(null, { name: "C", contact: null, phone: null, email: null, note: null, markup: {} });
    const t1 = await topup.createTopup({ customerId: cid, method: "zelle", amountUsd: 50, reference: "R1" });
    const t2 = await topup.createTopup({ customerId: cid, method: "zelle", amountUsd: 30, reference: "R2" });
    const t3 = await topup.createTopup({ customerId: cid, method: "zelle", amountUsd: 10, reference: "R3" });
    const by = actor.actorOf({ role: "staff", id: amy, name: "Amy" });
    topup.approveTopup(t1, 50, null, by);
    topup.approveTopup(t2, 30, null, actor.actorOf({ role: "owner", id: 0, name: "主管理员" }));
    topup.rejectTopup(t3, "没收到", by);
    expect(actor.actorLabel(topup.getTopup(t1)!.handledBy)).toBe("Amy");
    expect(actor.actorLabel(topup.getTopup(t2)!.handledBy)).toBe("主管理员");
    expect(actor.actorLabel(topup.getTopup(t3)!.handledBy)).toBe("Amy");
    const rows = ledger.listLedger({ customerId: cid });
    expect(rows.map((r) => actor.actorLabel(r.createdBy)).sort()).toEqual(["Amy", "主管理员"].sort());
    // 删掉员工后，老记录里的名字还在
    st.deleteStaff(amy);
    expect(actor.actorLabel(topup.getTopup(t1)!.handledBy)).toBe("Amy");
    expect(actor.actorLabel("admin")).toBe("主管理员");
    expect(actor.actorLabel("customer")).toBe("客户");
  });

  it("客户权限：新员工默认看不到；指定客户只能看 / 能操作；全部客户模式可以单独排除；自己新建的客户自动能操作", async () => {
    const auth = await import("@/lib/auth");
    const id = st.createStaff({ name: "Bob", username: "bob", password: "bob-pass-1" });
    const who = { role: "staff" as const, id, name: "Bob", username: "bob" };
    const see = () => [1, 2, 3, 4].filter(ses.customerFilter(who));
    expect(see()).toEqual([]);
    expect(auth.customerDenied(who, 1, "view")).toMatch(/没有这个客户的权限/);
    st.setStaffAccess(id, { mode: "list", customers: { "1": "view", "2": "edit", "3": "none" } });
    expect(see()).toEqual([1, 2]);
    expect(auth.customerDenied(who, 1, "view")).toBeNull();
    expect(auth.customerDenied(who, 1, "edit")).toMatch(/只有查看权限/);
    expect(auth.customerDenied(who, 2, "edit")).toBeNull();
    expect(st.getStaff(id)!.access).toEqual({ mode: "list", customers: { "1": "view", "2": "edit" } }); // none 不用存
    st.setStaffAccess(id, { mode: "all", customers: { "1": "edit", "3": "none", "4": "view" } });
    expect(see()).toEqual([1, 2, 4]);
    expect(ses.customerAccess(who, 4)).toBe("view");
    expect(ses.customerAccess(who, 99)).toBe("edit"); // 以后新增的客户默认能操作
    // 员工新建客户：全部客户模式下去掉排除；指定客户模式下加进名单
    st.grantCustomer(id, 3);
    expect(ses.customerAccess(who, 3)).toBe("edit");
    st.setStaffAccess(id, { mode: "list", customers: {} });
    st.grantCustomer(id, 7);
    expect(see()).toEqual([]);
    expect(ses.customerAccess(who, 7)).toBe("edit");
    // 主管理员不受限
    expect(ses.customerAccess({ role: "owner", id: 0, name: "主管理员" }, 7)).toBe("edit");
    // 第一版建的账号（没有 access 字段）= 全部客户
    expect(st.customerLevel({}, 5)).toBe("edit");
  });
});
