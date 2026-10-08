import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

/**
 * 安全检查修复（员工权限、公司自用账户、登录限次、代操作、重置密码链接、店铺授权回调）。
 * Server Action / 页面直接当函数调用：next/headers 的 cookie 和请求头用下面的内存版代替，
 * redirect / notFound 抛出带标记的错误，方便断言。
 */
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-sec-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";
process.env.SESSION_SECRET = "test-secret-1234567890";
process.env.ADMIN_PASSWORD = "pw-1234";
for (const k of ["OMS_URL", "ADMIN_URL", "APP_URL", "ALLOWED_ORIGINS", "APP_ENV", "SMTP_HOST"]) delete process.env[k];

const S = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  hdr: new Map<string, string>(),
  smtp: false,
  mails: [] as { to: string; text: string }[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (S.jar.has(n) ? { name: n, value: S.jar.get(n)! } : undefined),
    set: (n: string, v: string) => void S.jar.set(n, v),
    delete: (n: string) => void S.jar.delete(n),
  }),
  headers: async () => new Headers([...S.hdr]),
}));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  redirect: (u: string) => {
    throw new Error(`NEXT_REDIRECT:${u}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
// 不连真实邮件服务器：记下要发的邮件
vi.mock("@/lib/mailer", async (orig) => ({
  ...(await orig<typeof import("@/lib/mailer")>()),
  smtpConfigured: () => S.smtp,
  sendMail: async (to: string, _subject: string, text: string) => {
    S.mails.push({ to, text });
  },
}));

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", phone: "9095550100", country: "US", city: "Ontario", address1: "1 Main St", zipCode: "91761", province: "CA" },
  recipient: { nameFirst: "John", nameLast: "Doe", phone: "5125550100", country: "US", city: "Austin", address1: "2 Elm St", zipCode: "73301", province: "TX" },
  pkg: { length: 10, width: 8, height: 4, weight: 2, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "A1", productNameCn: "T恤", productNameEn: "T-shirt", quantity: 1, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 10, width: 8, height: 4, weight: 2, unit: 3 }],
};

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
/** 跑一下，返回抛出的错误信息（redirect / notFound 也是抛错） */
async function thrown(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "(no throw)";
  } catch (e) {
    return (e as Error).message;
  }
}
/** 页面返回的 React 元素树：收集里面的组件类型和文字 */
function walk(node: unknown, out: { types: unknown[]; text: string[] } = { types: [], text: [] }) {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") out.text.push(String(node));
  else if (Array.isArray(node)) node.forEach((n) => walk(n, out));
  else if (typeof node === "object" && "props" in (node as object)) {
    const el = node as { type: unknown; props: { children?: unknown } };
    out.types.push(el.type);
    walk(el.props?.children, out);
  }
  return out;
}

describe("安全修复", () => {
  let db: typeof import("@/lib/db");
  let st: typeof import("@/lib/staffStore");
  let ses: typeof import("@/lib/adminSession");
  let auth: typeof import("@/lib/auth");
  let actions: typeof import("@/app/actions");
  let portal: typeof import("@/app/portal/actions");
  let qs: typeof import("@/lib/quoteStream");
  let house: number;
  let cid: number;
  let other: number;
  let sid: number;
  const owner = { role: "owner" as const, id: 0 as const, name: "主管理员" };
  let staffWho: { role: "staff"; id: number; name: string; username: string };

  const exp = () => Math.floor(Date.now() / 1000) + 3600;
  const ownerToken = () => `${exp()}.${ses.adminMac(exp())}`;
  const staffTokenOf = (id: number) => ses.staffToken(id, st.getStaff(id)!.ver, exp());
  const asOwner = () => {
    S.jar.clear();
    S.jar.set(ses.ADMIN_COOKIE, ownerToken());
  };
  const asStaff = (id = sid) => {
    S.jar.clear();
    S.jar.set(ses.ADMIN_COOKIE, staffTokenOf(id));
  };
  const asCookieName = () => [...S.jar.keys()].find((k) => k.startsWith("atr_portal_as"));
  const collect = async (who: import("@/lib/quoteStream").QuoteStreamWho, input: import("@/lib/quoteStream").QuoteStreamInput) => {
    const events: import("@/lib/quoteStream").QuoteStreamEvent[] = [];
    await qs.runQuoteStream(who, input, (e) => events.push(e));
    return events;
  };

  beforeAll(async () => {
    db = await import("@/lib/db");
    st = await import("@/lib/staffStore");
    ses = await import("@/lib/adminSession");
    auth = await import("@/lib/auth");
    actions = await import("@/app/actions");
    portal = await import("@/app/portal/actions");
    qs = await import("@/lib/quoteStream");
    const svc = await import("@/lib/service");
    await svc.syncChannels();
    house = db.houseCustomerId();
    cid = db.saveCustomer(null, { name: "普通客户", contact: null, phone: null, email: null, note: null, markup: { percent: 10 } });
    other = db.saveCustomer(null, { name: "别的客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(cid, db.listChannels().filter((c) => !/HWT|MWT/.test(c.name)).map((c) => c.code));
    sid = st.createStaff({ name: "Eve", username: "eve", password: "eve-pass-1" });
    staffWho = { role: "staff", id: sid, name: "Eve", username: "eve" };
    S.hdr.set("x-forwarded-for", "203.0.113.1");
  });

  /* ---------------- 1. 公司自用账户 ---------------- */

  it("员工“全部客户”模式（包括第一版没有权限字段的账号）、单独授权，都看不到也操作不了公司自用账户", async () => {
    st.setStaffAccess(sid, { mode: "all", customers: {} });
    expect(ses.customerAccess(staffWho, cid)).toBe("edit");
    expect(ses.customerAccess(staffWho, house)).toBeNull();
    expect(st.customerLevel(st.getStaff(sid), house)).toBeNull();
    expect(st.customerLevel({}, house)).toBeNull(); // 没有 access 字段 = 全部客户，也不含公司自用账户
    expect(st.customerLevel({}, cid)).toBe("edit");
    expect(ses.customerFilter(staffWho)(house)).toBe(false);
    expect(auth.customerDenied(staffWho, house, "view")).toMatch(/没有这个客户的权限/);
    st.setStaffAccess(sid, { mode: "list", customers: { [String(house)]: "edit", [String(cid)]: "edit" } });
    expect(ses.customerAccess(staffWho, house)).toBeNull();
    st.setStaffAccess(sid, { mode: "all", customers: {} });
    // 主管理员不受影响；proxy 不打开数据库，只做粗检查
    expect(ses.customerAccess(owner, house)).toBe("edit");
    expect(ses.customerAccess(staffWho, house, { skipInternal: true })).toBe("edit");
  });

  it("复现的攻击链走不通：员工给公司自用账户开登录、设密码被拒；主管理员也不能给它开登录", async () => {
    asStaff();
    expect((await actions.saveCustomerPortalAction(null, fd({ id: String(house), portalEmail: "eve@evil.test", portalEnabled: "on" })))?.error).toMatch(/没有这个客户的权限/);
    expect((await actions.setCustomerPasswordAction(null, fd({ id: String(house), password: "eve-pass-123" })))?.error).toMatch(/没有这个客户的权限/);
    expect((await actions.ledgerEntryAction(null, fd({ id: String(house), type: "topup", amount: "10", financePin: "0000" })))?.error).toBeTruthy();
    asOwner();
    expect((await actions.saveCustomerPortalAction(null, fd({ id: String(house), portalEmail: "boss@atr.test", portalEnabled: "on" })))?.error).toMatch(/公司自用账户/);
    expect((await actions.setCustomerPasswordAction(null, fd({ id: String(house), password: "boss-pass-123" })))?.error).toMatch(/公司自用账户/);
    expect(db.getCustomer(house)!.portalEnabled).toBe(false);
    expect(db.getPasswordHash(house)).toBeNull();
    // 关掉登录（清理）可以；普通客户照常开通
    expect((await actions.saveCustomerPortalAction(null, fd({ id: String(house), portalEmail: "" })))?.ok).toBeTruthy();
    expect((await actions.saveCustomerPortalAction(null, fd({ id: String(cid), portalEmail: "c1@example.test", portalEnabled: "on", creditLimit: "0" })))?.ok).toBeTruthy();
    expect((await actions.setCustomerPasswordAction(null, fd({ id: String(cid), password: "c1-pass-123" })))?.ok).toBeTruthy();
  });

  it("就算数据库里公司自用账户已经开了登录：客户 OMS 登录、已有的会话、代操作、重置密码都不认", async () => {
    db.updateCustomerPortal(house, { email: "house@atr.test", enabled: true, creditLimit: 0 });
    db.setCustomerPassword(house, auth.hashPassword("house-pass-1"));
    S.jar.clear();
    const r = await portal.portalLoginAction(undefined, fd({ email: "house@atr.test", password: "house-pass-1" }));
    expect(r?.error).toMatch(/邮箱或密码错误/);
    expect(S.jar.size).toBe(0);
    // 有合法签名的会话也不认
    await auth.createCustomerSession(house, db.getPasswordHash(house)!);
    expect(await auth.currentCustomerId()).toBeNull();
    // 普通客户的会话正常
    S.jar.clear();
    await auth.createCustomerSession(cid, db.getPasswordHash(cid)!);
    expect(await auth.currentCustomerId()).toBe(cid);
    // 主管理员“进入客户 OMS”：公司自用账户不行
    asOwner();
    expect(await auth.enterAsCustomer(auth.makeEnterToken(house))).toBeNull();
    expect(asCookieName()).toBeUndefined();
    // 后台处理公司自用账户的重置密码申请：拒绝
    const pr = await import("@/lib/passwordReset");
    await pr.requestReset("house@atr.test", "https://oms.atr.test");
    const reqId = (db.db().prepare("SELECT id FROM password_resets WHERE customer_id = ? ORDER BY id DESC").get(house) as { id: number }).id;
    expect((await actions.handleResetRequestAction(null, fd({ id: String(reqId) })))?.error).toMatch(/公司自用账户/);
    // 带着重置链接也设不了密码、登录不了
    db.db().prepare("DELETE FROM password_resets").run();
    S.smtp = true;
    S.mails.length = 0;
    await pr.requestReset("house@atr.test", "https://oms.atr.test");
    const token = /token=([\w-]+)/.exec(S.mails[0]?.text ?? "")?.[1];
    expect(token).toBeTruthy();
    S.jar.clear();
    expect((await portal.portalResetAction(undefined, fd({ token: token!, password: "new-house-pw", confirm: "new-house-pw" })))?.error).toMatch(/链接已失效/);
    expect(auth.verifyPassword("new-house-pw", db.getPasswordHash(house))).toBe(false);
    // 客户 OMS 忘记密码：公司自用账户不处理（回复和邮箱不存在一样）
    process.env.APP_URL = "https://oms.atr.test";
    S.mails.length = 0;
    db.db().prepare("DELETE FROM password_resets").run();
    expect((await portal.portalForgotAction(undefined, fd({ email: "house@atr.test" })))?.ok).toMatch(/如果这个邮箱已开通账号/);
    expect(S.mails).toEqual([]);
    delete process.env.APP_URL;
    S.smtp = false;
    db.updateCustomerPortal(house, { email: null, enabled: false, creditLimit: 0 });
  });

  it("员工后台运费试算 / 多箱选公司自用账户：拒绝（不会拿到成本价）", async () => {
    const ev = await collect({ kind: "admin", admin: staffWho }, { mode: "admin", customerId: house, req });
    expect(ev).toEqual([{ t: "err", errors: ["你没有这个客户的权限，请找主管理员授权"] }]);
    asStaff();
    const multi = await import("@/app/multiActions");
    expect((await multi.multiQuoteAction({ customerId: house, req })).errors?.[0]).toMatch(/没有这个客户的权限/);
  });

  /* ---------------- 2. 客户页面的权限检查 ---------------- */

  it("proxy：员工打开不是纯数字的客户编号（5.0、%35、0x5、05…）一律挡回；/customers/new 可以", async () => {
    const { proxy } = await import("@/proxy");
    const { NextRequest } = await import("next/server");
    const limited = st.createStaff({ name: "Lim", username: "lim", password: "lim-pass-1" });
    st.setStaffAccess(limited, { mode: "list", customers: { "3": "view" } });
    const cookie = `${ses.ADMIN_COOKIE}=${staffTokenOf(limited)}`;
    const go = (p: string, c = cookie) => proxy(new NextRequest(new URL(p, "http://localhost:3000"), { headers: { cookie: c } })).headers.get("location");
    const denied = "http://localhost:3000/customers?denied=customer";
    for (const p of ["/customers/5.0", "/customers/%35", "/customers/0x5", "/customers/05", "/customers/3.0", "/customers/%33", "/customers/5.0/statement", "/customers/0x5/charges", "/customers/%35/terms", "/customers/abc", "/customers/new/x", "/customers/4"]) {
      expect(go(p), p).toBe(denied);
    }
    for (const p of ["/customers", "/customers/3", "/customers/3/statement", "/customers/new"]) expect(go(p), p).toBeNull();
    // 主管理员不受影响（页面自己会 404）
    expect(go("/customers/5.0", `${ses.ADMIN_COOKIE}=${ownerToken()}`)).toBeNull();
    expect(ses.customerPathTarget("/customers")).toBeNull();
    expect(ses.customerPathTarget("/customers/12/statement")).toEqual({ id: 12 });
    expect(ses.customerPathTarget("/customers/new")).toBe("new");
    expect(ses.customerPathTarget("/customers/1e1")).toBe("invalid");
  });

  it("客户详情、扣款明细、对账单、条款存档页面自己检查权限：没权限 / 编号写法不对都 404", async () => {
    const { customerPageAccess } = await import("@/app/(admin)/customers/[id]/access");
    const pages = {
      charges: (await import("@/app/(admin)/customers/[id]/charges/page")).default,
      statement: (await import("@/app/(admin)/customers/[id]/statement/page")).default,
      terms: (await import("@/app/(admin)/customers/[id]/terms/page")).default,
      detail: (await import("@/app/(admin)/customers/[id]/page")).default,
    };
    const open = (name: keyof typeof pages, id: string) =>
      (pages[name] as (p: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) => Promise<unknown>)({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });

    st.setStaffAccess(sid, { mode: "list", customers: { [String(cid)]: "view" } });
    asStaff();
    expect((await customerPageAccess(String(cid))).level).toBe("view");
    for (const bad of [`${cid}.0`, `0x${cid.toString(16)}`, `0${cid}`, ` ${cid}`, String(other), String(house)]) {
      expect(await thrown(customerPageAccess(bad)), bad).toBe("NEXT_NOT_FOUND");
      for (const name of Object.keys(pages) as (keyof typeof pages)[]) expect(await thrown(open(name, bad)), `${name} ${bad}`).toBe("NEXT_NOT_FOUND");
    }
    for (const name of Object.keys(pages) as (keyof typeof pages)[]) expect(await thrown(open(name, String(cid))), name).toBe("(no throw)");
    // 全部客户模式：公司自用账户的页面也是 404（proxy 判断不了，页面自己挡）
    st.setStaffAccess(sid, { mode: "all", customers: {} });
    for (const name of Object.keys(pages) as (keyof typeof pages)[]) expect(await thrown(open(name, String(house))), name).toBe("NEXT_NOT_FOUND");
    // 主管理员：编号写法不对也是 404，正常编号能开
    asOwner();
    expect(await thrown(open("statement", `${cid}.0`))).toBe("NEXT_NOT_FOUND");
    expect(await thrown(open("detail", String(house)))).toBe("(no throw)");
  });

  it("开户信息（初始密码）只给能操作这个客户的人看：只读员工看不到", async () => {
    const CredentialsCard = (await import("@/components/CredentialsCard")).default;
    const Page = (await import("@/app/(admin)/customers/[id]/page")).default;
    const { rememberCredentials } = await import("@/lib/credentials");
    rememberCredentials(cid, "c1@example.test", "Secret-Pass-9");
    const render = async () => walk(await Page({ params: Promise.resolve({ id: String(cid) }), searchParams: Promise.resolve({}) }));
    st.setStaffAccess(sid, { mode: "list", customers: { [String(cid)]: "view" } });
    asStaff();
    expect((await render()).types).not.toContain(CredentialsCard);
    st.setStaffAccess(sid, { mode: "list", customers: { [String(cid)]: "edit" } });
    expect((await render()).types).toContain(CredentialsCard);
    asOwner();
    expect((await render()).types).toContain(CredentialsCard);
  });

  /* ---------------- 3. 员工倒推不出成本 ---------------- */

  it("员工的报价里没有加价规则（加价 %、返利、活动）；主管理员有", async () => {
    st.setStaffAccess(sid, { mode: "list", customers: { [String(cid)]: "view" } });
    const staffEv = await collect({ kind: "admin", admin: staffWho }, { mode: "admin", customerId: cid, req });
    const staffQuotes = [...(staffEv.find((e) => e.t === "done") as { quotes: Record<string, unknown>[] }).quotes, ...staffEv.filter((e) => e.t === "q").map((e) => (e as { q: Record<string, unknown> }).q)];
    expect(staffQuotes.some((q) => q.ok && typeof q.price === "number")).toBe(true);
    for (const q of staffQuotes) for (const k of ["rule", "cost", "listCost", "profit", "ms"]) expect(q, k).not.toHaveProperty(k);
    const ownerEv = await collect({ kind: "admin", admin: owner }, { mode: "admin", customerId: cid, req });
    const ownerQuotes = (ownerEv.find((e) => e.t === "done") as { quotes: Record<string, unknown>[] }).quotes;
    expect(ownerQuotes.some((q) => q.ok && q.rule && typeof q.cost === "number")).toBe(true);
  });

  it("员工试算新客户：临时加价每一项都不能低于全局默认（0 / 0 / 0 = 成本价）；留空照旧；主管理员不限", async () => {
    const g = db.getSettings().markup;
    expect(g.percent).toBeGreaterThan(0);
    const staff = { kind: "admin" as const, admin: staffWho };
    for (const markup of [{ percent: 0, fixed: 0, minProfit: 0 }, { percent: g.percent - 0.01 }, { fixed: g.fixed - 1 >= 0 ? g.fixed - 1 : -0.5 }, { percent: "abc" as unknown as number }]) {
      const ev = await collect(staff, { mode: "admin", customerId: 0, markup, req });
      expect(ev.length, JSON.stringify(markup)).toBe(1);
      expect(ev[0].t).toBe("err");
    }
    expect(await collect(staff, { mode: "admin", customerId: 0, markup: { percent: 0, fixed: 0, minProfit: 0 }, req })).toEqual([{ t: "err", errors: [qs.STAFF_PROSPECT_MARKUP_ERROR] }]);
    for (const markup of [{}, { percent: null, fixed: null, minProfit: null }, { percent: g.percent, fixed: g.fixed, minProfit: g.minProfit }, { percent: g.percent + 20 }]) {
      const ev = await collect(staff, { mode: "admin", customerId: 0, markup, req });
      expect(ev.some((e) => e.t === "done"), JSON.stringify(markup)).toBe(true);
    }
    // 主管理员可以按成本试算
    const ev = await collect({ kind: "admin", admin: owner }, { mode: "admin", customerId: 0, markup: { percent: 0, fixed: 0, minProfit: 0 }, req });
    const q = (ev.find((e) => e.t === "done") as { quotes: { ok: boolean; price?: number; cost?: number }[] }).quotes.find((x) => x.ok)!;
    expect(q.price).toBeCloseTo(q.cost!, 1);
  });

  it("客户详情“渠道与价格”：员工看不到服务商返利；主管理员看得到", async () => {
    const Page = (await import("@/app/(admin)/customers/[id]/page")).default;
    const code = db.customerChannels(cid)[0].code;
    db.setChannelRebate(code, 7);
    const render = async () => walk(await Page({ params: Promise.resolve({ id: String(cid) }), searchParams: Promise.resolve({ tab: "pricing" }) })).text.join(" ");
    st.setStaffAccess(sid, { mode: "list", customers: { [String(cid)]: "edit" } });
    asStaff();
    const staffText = await render();
    expect(staffText).toContain("按渠道加价");
    expect(staffText).not.toMatch(/返利/);
    asOwner();
    expect(await render()).toContain("返利 7%");
  });

  it("员工给客户设加价：每一项不能低于全局默认（设成 0 就是成本价）；主管理员设的更低的值员工保存其他内容不受影响", async () => {
    db.saveSettings({ markup: { percent: 5, fixed: 0, minProfit: 0.3 } });
    const code = db.customerChannels(cid)[0].code;
    st.setStaffAccess(sid, { mode: "list", customers: { [String(cid)]: "edit" } });
    const mk = await import("@/lib/markup");
    mk.setCustomerChannelMarkups(cid, { [code]: {} });
    asStaff();
    const zero = await actions.saveCustomerChannelMarkupAction(null, fd({ id: String(cid), [`${code}.percent`]: "0", [`${code}.fixed`]: "0", [`${code}.minProfit`]: "0" }));
    expect(zero?.error).toMatch(/不能低于全局默认/);
    expect(mk.customerChannelMarkups(cid)[code]).toBeUndefined();
    expect((await actions.saveCustomerChannelMarkupAction(null, fd({ id: String(cid), [`${code}.percent`]: "8" })))?.ok).toBeTruthy();
    // 主管理员设了更低的 2%，员工原样保存（没改这一项）照常通过，改成 1% 不行
    asOwner();
    expect((await actions.saveCustomerChannelMarkupAction(null, fd({ id: String(cid), [`${code}.percent`]: "2" })))?.ok).toBeTruthy();
    asStaff();
    expect((await actions.saveCustomerChannelMarkupAction(null, fd({ id: String(cid), [`${code}.percent`]: "2", [`${code}.fixed`]: "0.5" })))?.ok).toBeTruthy();
    expect((await actions.saveCustomerChannelMarkupAction(null, fd({ id: String(cid), [`${code}.percent`]: "1" })))?.error).toMatch(/不能低于全局默认/);
    asOwner();
    mk.setCustomerChannelMarkups(cid, { [code]: {} });
  });

  /* ---------------- 5. 登录限次不能被用来锁别人的账号 ---------------- */

  it("后台登录：别人换着 IP 输错 50 次以上，主管理员用对的密码照样能登录；同一个 IP 输错 10 次才挡", async () => {
    S.jar.clear();
    for (let i = 0; i < 60; i++) {
      S.hdr.set("x-forwarded-for", `198.51.100.${i}`);
      expect((await actions.loginAction(undefined, fd({ username: "", password: `wrong-${i}` })))?.error).toBe("密码错误");
    }
    S.hdr.set("x-forwarded-for", "198.51.100.200");
    expect(await thrown(actions.loginAction(undefined, fd({ username: "", password: "pw-1234" })))).toBe("NEXT_REDIRECT:/");
    // 同一个 IP 输错 10 次：这个 IP 暂时不能再试（密码对的也不行）
    S.hdr.set("x-forwarded-for", "198.51.100.201");
    for (let i = 0; i < 10; i++) await actions.loginAction(undefined, fd({ username: "", password: "nope" }));
    expect((await actions.loginAction(undefined, fd({ username: "", password: "pw-1234" })))?.error).toMatch(/尝试次数过多/);
    // X-Forwarded-For 第一段是访客自己填的，换它绕不过去
    S.hdr.set("x-forwarded-for", "10.9.9.9, 198.51.100.201");
    expect((await actions.loginAction(undefined, fd({ username: "", password: "pw-1234" })))?.error).toMatch(/尝试次数过多/);
    S.hdr.set("x-forwarded-for", "203.0.113.1");
  });

  it("客户登录：别人换着 IP 输错 30 次以上，客户用对的密码照样能登录；同一个 IP 输错 10 次才挡", async () => {
    S.jar.clear();
    for (let i = 0; i < 35; i++) {
      S.hdr.set("x-forwarded-for", `192.0.2.${i}`);
      expect((await portal.portalLoginAction(undefined, fd({ email: "c1@example.test", password: `wrong-${i}` })))?.error).toMatch(/邮箱或密码错误/);
    }
    S.hdr.set("x-forwarded-for", "192.0.2.200");
    expect(await thrown(portal.portalLoginAction(undefined, fd({ email: "c1@example.test", password: "c1-pass-123" })))).toBe("NEXT_REDIRECT:/portal");
    S.hdr.set("x-forwarded-for", "192.0.2.201");
    for (let i = 0; i < 10; i++) await portal.portalLoginAction(undefined, fd({ email: "c1@example.test", password: "nope" }));
    expect((await portal.portalLoginAction(undefined, fd({ email: "c1@example.test", password: "c1-pass-123" })))?.error).toMatch(/尝试次数过多/);
    S.hdr.set("x-forwarded-for", "203.0.113.1");
  }, 30_000);

  /* ---------------- 7. eBay 授权回调 ---------------- */

  it("eBay 授权回调：只认发起连接的那个客户自己的浏览器", async () => {
    const stores = await import("@/lib/stores");
    const { GET } = await import("@/app/api/stores/ebay/callback/route");
    const { state, id } = stores.startEbayConnection(cid);
    const call = (q: string) => GET(new Request(`https://oms.atr.test/api/stores/ebay/callback?${q}`, { headers: { host: "oms.atr.test" } }));
    // 没登录（例如攻击者把自己的授权链接发给卖家）：拒绝，不会去 eBay 换令牌
    S.jar.clear();
    const r1 = await call(`state=${state}&code=abc`);
    expect(r1.status).toBe(400);
    expect(await r1.text()).toContain("请在同一个浏览器里先登录客户中心");
    expect(stores.getStore(id)).not.toBeNull();
    // 别的客户登录着：也拒绝
    db.updateCustomerPortal(other, { email: "other@example.test", enabled: true, creditLimit: 0 });
    db.setCustomerPassword(other, auth.hashPassword("other-pass-1"));
    await auth.createCustomerSession(other, db.getPasswordHash(other)!);
    expect((await call(`state=${state}&code=abc`)).status).toBe(400);
    // 发起连接的客户自己（卖家在 eBay 点了拒绝）：正常处理
    S.jar.clear();
    await auth.createCustomerSession(cid, db.getPasswordHash(cid)!);
    const r3 = await call(`state=${state}`);
    expect(r3.status).toBe(307);
    expect(r3.headers.get("location")).toContain("/portal/stores?denied=1");
    expect(stores.getStore(id)).toBeNull();
  });

  /* ---------------- 8. 重置密码链接不用伪造的 Host ---------------- */

  it("忘记密码：没配置网址时不用请求里的 Host 拼链接；Host 是配置过的域名才用；配置了 APP_URL / OMS_URL 就用配置的", async () => {
    S.smtp = true;
    const clear = () => {
      S.mails.length = 0;
      db.db().prepare("DELETE FROM password_resets").run();
    };
    const warn = console.warn;
    const warned: unknown[] = [];
    console.warn = (...a: unknown[]) => void warned.push(a);
    try {
      clear();
      S.hdr.set("x-forwarded-for", "192.0.2.150");
      S.hdr.set("host", "evil.example");
      const r = await portal.portalForgotAction(undefined, fd({ email: "c1@example.test" }));
      expect(r?.ok).toMatch(/如果这个邮箱已开通账号/);
      expect(S.mails).toEqual([]);
      expect(warned.length).toBe(1);

      // 后台网址 / ALLOWED_ORIGINS 里写明的域名可以用
      clear();
      process.env.ALLOWED_ORIGINS = "*.app.github.dev,oms.atr.test";
      S.hdr.set("host", "oms.atr.test");
      S.hdr.set("x-forwarded-proto", "https");
      await portal.portalForgotAction(undefined, fd({ email: "c1@example.test" }));
      expect(S.mails[0]?.text).toContain("https://oms.atr.test/portal/reset?token=");
      clear();
      S.hdr.set("host", "x.app.github.dev"); // 通配的不算
      await portal.portalForgotAction(undefined, fd({ email: "c1@example.test" }));
      expect(S.mails).toEqual([]);

      // 配置了 OMS_URL：不管 Host 是什么都用配置的
      clear();
      process.env.OMS_URL = "https://oms.real.test";
      S.hdr.set("host", "evil.example");
      await portal.portalForgotAction(undefined, fd({ email: "c1@example.test" }));
      expect(S.mails[0]?.text).toContain("https://oms.real.test/portal/reset?token=");
      expect(S.mails[0]?.text).not.toContain("evil.example");
    } finally {
      console.warn = warn;
      delete process.env.OMS_URL;
      delete process.env.ALLOWED_ORIGINS;
      S.hdr.delete("host");
      S.hdr.delete("x-forwarded-proto");
      S.hdr.set("x-forwarded-for", "203.0.113.1");
      S.smtp = false;
    }
  });

  /* ---------------- 9. 代操作只在后台登录有效时才认 ---------------- */

  it("代操作（进入客户 OMS）：后台登录没了、换成员工、过期、主管理员退出后都不认", async () => {
    asOwner();
    expect(await auth.enterAsCustomer(auth.makeEnterToken(cid))).toBe(cid);
    const name = asCookieName()!;
    const value = S.jar.get(name)!;
    expect(await auth.impersonatedCustomerId()).toBe(cid);
    expect(await auth.currentCustomerId()).toBe(cid);
    S.jar.delete(ses.ADMIN_COOKIE);
    expect(await auth.impersonatedCustomerId()).toBeNull();
    S.jar.set(ses.ADMIN_COOKIE, staffTokenOf(sid));
    expect(await auth.impersonatedCustomerId()).toBeNull();
    const old = Math.floor(Date.now() / 1000) - 10;
    S.jar.set(ses.ADMIN_COOKIE, `${old}.${ses.adminMac(old)}`);
    expect(await auth.impersonatedCustomerId()).toBeNull();
    S.jar.set(ses.ADMIN_COOKIE, ownerToken());
    expect(await auth.impersonatedCustomerId()).toBe(cid);
    // 退出后台：代操作 cookie 一起删掉；就算留着、再登录回来，退出前进入的也不认
    await auth.destroySession();
    expect(S.jar.has(name)).toBe(false);
    S.jar.set(name, value);
    S.jar.set(ses.ADMIN_COOKIE, ownerToken());
    expect(await auth.impersonatedCustomerId()).toBeNull();
  });

  it("代操作：OMS 在单独的域名（收不到后台 cookie）时靠凭证；改后台密码、主管理员退出后作废", async () => {
    await new Promise((r) => setTimeout(r, 5)); // 和上一个测试的退出时间错开
    process.env.OMS_URL = "https://oms.atr.test";
    process.env.ADMIN_URL = "https://admin.atr.test";
    try {
      asOwner();
      // 进入凭证是一次性的：换一个客户，免得和上一个测试同一秒生成的凭证一样
      expect(await auth.enterAsCustomer(auth.makeEnterToken(other))).toBe(other);
      const name = asCookieName()!;
      const value = S.jar.get(name)!;
      S.jar.delete(ses.ADMIN_COOKIE); // OMS 域名上没有后台 cookie
      expect(await auth.impersonatedCustomerId()).toBe(other);
      // 后台 cookie 带过来了但无效（例如员工）：不认
      S.jar.set(ses.ADMIN_COOKIE, staffTokenOf(sid));
      expect(await auth.impersonatedCustomerId()).toBeNull();
      S.jar.delete(ses.ADMIN_COOKIE);
      // 改了后台密码：作废
      process.env.ADMIN_PASSWORD = "changed-pw-1";
      expect(await auth.impersonatedCustomerId()).toBeNull();
      process.env.ADMIN_PASSWORD = "pw-1234";
      expect(await auth.impersonatedCustomerId()).toBe(other);
      // 主管理员在后台域名退出（另一个请求）：OMS 这边的代操作也作废
      S.jar.clear();
      S.jar.set(ses.ADMIN_COOKIE, ownerToken());
      await auth.destroySession();
      S.jar.clear();
      S.jar.set(name, value);
      expect(await auth.impersonatedCustomerId()).toBeNull();
      // 公司自用账户：进不去
      await new Promise((r) => setTimeout(r, 5));
      asOwner();
      expect(await auth.enterAsCustomer(auth.makeEnterToken(house))).toBeNull();
    } finally {
      delete process.env.OMS_URL;
      delete process.env.ADMIN_URL;
    }
  });
});
