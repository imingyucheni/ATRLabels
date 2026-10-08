import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-api-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

describe("开放 API v1", () => {
  let db: typeof import("@/lib/db");
  let keys: typeof import("@/lib/api/keys");
  let ledger: typeof import("@/lib/ledger");
  let cid: number;
  let live: string;
  let test: string;
  const B = "https://oms.example.com";

  const call = async (method: string, p: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) => {
    const url = new URL(B + p);
    const req = new Request(url, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", "x-forwarded-for": "9.9.9.9", ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const segs = url.pathname.replace("/api/v1/", "").split("/");
    let res: Response;
    if (segs[0] === "orders" && segs.length > 1) {
      const sub = segs[2] ?? "";
      const mod = sub === "label" ? await import("@/app/api/v1/orders/[no]/label/route") : sub === "cancel" ? await import("@/app/api/v1/orders/[no]/cancel/route") : await import("@/app/api/v1/orders/[no]/route");
      res = await (mod as unknown as Record<string, (r: Request, c: unknown) => Promise<Response>>)[method](req, { params: Promise.resolve({ no: segs[1] }) });
    } else {
      const mod = await import(`@/app/api/v1/${segs[0]}/route`);
      res = await mod[method](req);
    }
    const ct = res.headers.get("content-type") ?? "";
    return { status: res.status, json: ct.includes("json") ? await res.json() : null, res };
  };

  const shipTo = { name: "Jane Roe", phone: "5125550100", address1: "500 Congress Ave", city: "Austin", state: "TX", postalCode: "78701", country: "US" };
  const pkg = { length: 10, width: 8, height: 4, weight: 1.5, unit: "in/lb" };

  beforeAll(async () => {
    db = await import("@/lib/db");
    keys = await import("@/lib/api/keys");
    ledger = await import("@/lib/ledger");
    const svc = await import("@/lib/service");
    const terms = await import("@/lib/terms");
    db.saveSettings({ sender: { nameFirst: "ATR", nameLast: "Warehouse", country: "US", province: "CA", city: "Chino", address1: "13950 Central Ave", zipCode: "91710", phone: "9095550100" } });
    await svc.syncChannels();
    cid = db.saveCustomer(null, { name: "API 客户", contact: null, phone: null, email: null, note: null, markup: {} });
    // 用 API 的客户都开通了客户端登录（密钥是客户自己在 OMS 里生成的）；登录关掉后 API 也不能用
    db.updateCustomerPortal(cid, { email: "api@example.com", enabled: true, creditLimit: 0 });
    db.setCustomerChannels(cid, db.listChannels().map((c) => c.code).filter((c) => !c.startsWith("DHL-")));
    ledger.addLedger({ customerId: cid, type: "topup", amount: 100, createdBy: "admin" });
    terms.acceptTerms({ customerId: cid, party: terms.partyOf(db.getCustomer(cid)!), signer: "Amy", signerTitle: "Owner", lang: "zh", ip: null, userAgent: null });
    live = keys.createKey(cid, { mode: "live" }).token;
    test = keys.createKey(cid, { mode: "test", name: "领星测试" }).token;
  });

  it("鉴权：没带密钥 / 密钥错 / 没开通 API / IP 不在白名单", async () => {
    expect((await call("GET", "/api/v1/balance", null)).json).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    expect((await call("GET", "/api/v1/balance", "atr_live_wrong")).status).toBe(401);
    expect((await call("GET", "/api/v1/balance", live)).json.code).toBe("API_DISABLED");
    keys.setApiEnabled(cid, true);
    expect((await call("GET", "/api/v1/balance", live)).json).toMatchObject({ success: true, data: { balance: 100, currency: "USD" } });
    // X-Api-Key 也可以
    expect((await call("GET", "/api/v1/balance", null, undefined, { "x-api-key": live })).status).toBe(200);
    const { key, token } = keys.createKey(cid, { mode: "live", ipAllow: "1.2.3.4" });
    expect((await call("GET", "/api/v1/balance", token)).json.code).toBe("IP_NOT_ALLOWED");
    keys.revokeKey(key.id, cid);
    expect((await call("GET", "/api/v1/balance", token)).status).toBe(401);
    expect(() => keys.parseIpAllow("1.2.3.4, abc")).toThrow(/IP/);
  });

  it("渠道和报价：只看到自己开通的渠道，价格从低到高", async () => {
    const ch = (await call("GET", "/api/v1/channels", live)).json.data as { channel: string; name: string; international: boolean }[];
    expect(ch.length).toBeGreaterThan(0);
    expect(ch.every((c) => !c.international)).toBe(true);
    const r = await call("POST", "/api/v1/rates", live, { shipTo, package: pkg });
    expect(r.status).toBe(200);
    const ok = (r.json.data as { available: boolean; price?: number }[]).filter((q) => q.available);
    expect(ok.length).toBeGreaterThan(0);
    expect(ok.map((q) => q.price)).toEqual([...ok.map((q) => q.price!)].sort((a, b) => a - b));
  });

  it("参数错误一次列出全部问题", async () => {
    const r = await call("POST", "/api/v1/rates", live, { shipTo: { name: "X" }, package: { unit: "furlong" } });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("VALIDATION_ERROR");
    expect(r.json.message).toMatch(/unit/);
    expect((await call("POST", "/api/v1/orders", live, { channel: "x" })).json.message).toMatch(/referenceNo/);
    const bad = new Request(B + "/api/v1/rates", { method: "POST", headers: { Authorization: `Bearer ${live}` }, body: "{oops" });
    const mod = await import("@/app/api/v1/rates/route");
    expect((await (await mod.POST(bad)).json()).code).toBe("INVALID_JSON");
  });

  it("正式密钥出单：扣余额；同一个 referenceNo 重试不重复出单；查单、取面单、取消退款", async () => {
    const rates = (await call("POST", "/api/v1/rates", live, { shipTo, package: pkg })).json.data as { channel: string; available: boolean; price: number }[];
    const best = rates.find((q) => q.available)!;
    const body = { referenceNo: "SO-1001", channel: best.channel, shipTo, package: pkg, items: [{ sku: "TS-1", name: "T-shirt", quantity: 1, unitValue: 12 }] };
    const r1 = await call("POST", "/api/v1/orders", live, body);
    expect(r1.status).toBe(200);
    expect(r1.json.data).toMatchObject({ created: true, order: { referenceNo: "SO-1001", channel: best.channel, price: best.price, test: false } });
    const no = r1.json.data.order.orderNo as string;
    expect(ledger.balanceOf(cid)).toBeCloseTo(100 - best.price, 2);
    const r2 = await call("POST", "/api/v1/orders", live, body);
    expect(r2.json.data).toMatchObject({ created: false, order: { orderNo: no } });
    expect(ledger.balanceOf(cid)).toBeCloseTo(100 - best.price, 2);

    // 模拟面单 1 秒后出
    await new Promise((r) => setTimeout(r, 1100));
    const g = await call("GET", `/api/v1/orders/${no}`, live);
    expect(g.json.data).toMatchObject({ orderNo: no, status: "labeled", labelReady: true });
    expect(g.json.data.trackingNo).toBeTruthy();
    expect(g.json.data.labelUrl).toBe(`${B}/api/v1/orders/${no}/label`);
    expect((await call("GET", `/api/v1/orders?referenceNo=SO-1001`, live)).json.data.orderNo).toBe(no);
    const pdf = await call("GET", `/api/v1/orders/${no}/label`, live);
    expect(pdf.res.headers.get("content-type")).toMatch(/pdf|png/);
    const b64 = await call("GET", `/api/v1/orders/${no}/label?format=base64`, live);
    expect(b64.json.data.content.length).toBeGreaterThan(100);

    const c = await call("POST", `/api/v1/orders/${no}/cancel`, live);
    expect(c.json.data.order.status).toMatch(/cancelled|cancelling/);
    if (c.json.data.done) expect(ledger.balanceOf(cid)).toBeGreaterThan(100 - best.price);
    expect((await call("GET", `/api/v1/orders/${no}/label`, live)).json?.code ?? "VOID").toMatch(/LABEL_VOID|VOID/);
  }, 30_000);

  it("测试密钥：模拟出单不扣钱；正式密钥看不到测试单", async () => {
    const before = ledger.balanceOf(cid);
    const rates = (await call("POST", "/api/v1/rates", test, { shipTo, package: pkg })).json.data as { channel: string; available: boolean }[];
    const ch = rates.find((q) => q.available)!.channel;
    const r = await call("POST", "/api/v1/orders", test, { referenceNo: "TEST-1", channel: ch, shipTo, package: pkg });
    expect(r.json.data.order.test).toBe(true);
    expect(ledger.balanceOf(cid)).toBe(before);
    const no = r.json.data.order.orderNo;
    expect((await call("GET", `/api/v1/orders/${no}`, live)).status).toBe(404);
    expect((await call("GET", `/api/v1/orders/${no}`, test)).status).toBe(200);
    const c = await call("POST", `/api/v1/orders/${no}/cancel`, test);
    expect(c.json.data.done).toBe(true);
    expect(ledger.balanceOf(cid)).toBe(before); // 没扣过也不退
  }, 30_000);

  it("余额不足返回 INSUFFICIENT_BALANCE；渠道没开通返回 CHANNEL_UNAVAILABLE", async () => {
    const rates = (await call("POST", "/api/v1/rates", live, { shipTo, package: pkg })).json.data as { channel: string; available: boolean; price: number }[];
    const ch = rates.find((q) => q.available)!;
    ledger.addLedger({ customerId: cid, type: "adjustment", amount: -ledger.balanceOf(cid), createdBy: "admin" });
    const r = await call("POST", "/api/v1/orders", live, { referenceNo: "SO-POOR", channel: ch.channel, shipTo, package: pkg });
    expect(r.status).toBe(402);
    expect(r.json.code).toBe("INSUFFICIENT_BALANCE");
    expect((await call("POST", "/api/v1/orders", live, { referenceNo: "SO-X", channel: "NOPE", shipTo, package: pkg })).json.code).toBe("CHANNEL_UNAVAILABLE");
  }, 30_000);

  it("IP 白名单按 X-Forwarded-For 的最后一段（反向代理加的真实来源）核对，第一段伪造不了", async () => {
    const { key, token } = keys.createKey(cid, { mode: "live", ipAllow: "1.2.3.4" });
    try {
      // 调用方自己在请求头里填白名单 IP：反向代理会把真实来源追加在最后，最后一段才算数
      expect((await call("GET", "/api/v1/balance", token, undefined, { "x-forwarded-for": "1.2.3.4, 9.9.9.9" })).json.code).toBe("IP_NOT_ALLOWED");
      expect((await call("GET", "/api/v1/balance", token, undefined, { "x-forwarded-for": "5.5.5.5, 1.2.3.4" })).status).toBe(200);
      const { clientIp } = await import("@/lib/api/http");
      const { ipFromHeaders } = await import("@/lib/auth");
      const h = new Headers({ "x-forwarded-for": "6.6.6.6, 7.7.7.7" });
      expect(clientIp(new Request("https://x/", { headers: h }))).toBe("7.7.7.7");
      expect(ipFromHeaders(h)).toBe("7.7.7.7"); // 和后台登录限流同一个规则
      expect(ipFromHeaders(new Headers({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
      expect(ipFromHeaders(new Headers())).toBeNull();
    } finally {
      keys.revokeKey(key.id, cid);
    }
  });

  it("API 开关和客户端登录分开（只用 API 的客户照常能用）；公司自用账户的密钥不能用", async () => {
    db.updateCustomerPortal(cid, { email: "api@example.com", enabled: false, creditLimit: 0 });
    expect((await call("GET", "/api/v1/balance", live)).status).toBe(200);
    db.updateCustomerPortal(cid, { email: "api@example.com", enabled: true, creditLimit: 0 });

    const house = db.houseCustomerId();
    keys.setApiEnabled(house, true);
    db.updateCustomerPortal(house, { email: null, enabled: true, creditLimit: 0 }); // 就算数据库里被打开了登录
    const hk = keys.createKey(house, { mode: "live" }).token;
    expect((await call("GET", "/api/v1/balance", hk)).json).toMatchObject({ success: false, code: "API_DISABLED", message: keys.ACCOUNT_DISABLED_MESSAGE });
  });

  it("服务器内部错误：调用记录（客户 OMS 能看到）里只记统一提示，原始报错只打在服务器日志", async () => {
    const { handle } = await import("@/lib/api/http");
    const req = new Request(B + "/api/v1/balance", { headers: { Authorization: `Bearer ${live}`, "x-forwarded-for": "9.9.9.9" } });
    const err = console.error;
    const logged: unknown[] = [];
    console.error = (...a: unknown[]) => void logged.push(a);
    let res: Response;
    try {
      res = await handle(req, async () => {
        throw new Error("ShipBest HTTP 502: upstream db password=hunter2 at 10.0.0.5");
      });
    } finally {
      console.error = err;
    }
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "INTERNAL", message: "服务器内部错误，请稍后重试" });
    const last = keys.listLogs(cid, 1)[0];
    expect(last).toMatchObject({ code: "INTERNAL", status: 500, message: keys.INTERNAL_MESSAGE });
    expect(JSON.stringify(keys.listLogs(cid))).not.toContain("hunter2");
    expect(logged.flat().map(String).join(" ")).toContain("hunter2"); // 服务器日志里还有原文，方便排查
  });

  it("频率限制：每个密钥每分钟 60 次；调用都有记录", () => {
    const t = 1_000_000;
    for (let i = 0; i < keys.RATE_PER_MIN; i++) expect(keys.rateLimit(999, t + i)).toBe(0);
    expect(keys.rateLimit(999, t + 100)).toBeGreaterThan(0);
    expect(keys.rateLimit(999, t + 61_000)).toBe(0);
    const logs = keys.listLogs(cid);
    expect(logs.length).toBeGreaterThan(5);
    expect(logs.some((l) => l.code === "INSUFFICIENT_BALANCE")).toBe(true);
  });
});
