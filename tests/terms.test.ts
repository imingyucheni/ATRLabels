import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-terms-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

describe("客户服务条款", () => {
  let db: typeof import("@/lib/db");
  let terms: typeof import("@/lib/terms");
  let cid: number;

  beforeAll(async () => {
    db = await import("@/lib/db");
    terms = await import("@/lib/terms");
    db.saveSettings({ brandName: "ATRShip", cancelWindowHours: 48 });
    cid = db.saveCustomer(null, {
      name: "Acme Trading LLC", contact: "Amy Chen", contactTitle: "物流主管", address: "100 Main St, Los Angeles, CA 90001",
      phone: "626-555-0100", email: "amy@acme.com", note: null, markup: {},
    });
  });

  it("客户资料保存地址和联系人职位；不传时保持原样", () => {
    expect(db.getCustomer(cid)).toMatchObject({ contactTitle: "物流主管", address: "100 Main St, Los Angeles, CA 90001" });
    db.saveCustomer(cid, { name: "Acme Trading LLC", contact: "Amy Chen", phone: "626-555-0100", email: "amy@acme.com", note: "x", markup: {} });
    expect(db.getCustomer(cid)!.contactTitle).toBe("物流主管");
  });

  it("条款自动带出公司、客户名称和可取消小时数", () => {
    const c = db.getCustomer(cid)!;
    const text = terms.renderTerms(terms.getTerms().zh, terms.partyOf(c));
    expect(text.startsWith("ATRShip 物流服务协议\n\n甲方（服务方）：Atronia Innovations Inc.\n地址：3134 Friendswood Ave, El Monte, CA 91733\n联系邮箱：info@innotronia.com\n\n乙方（客户）：Acme Trading LLC\n地址：100 Main St, Los Angeles, CA 90001\n联系人：Amy Chen · 物流主管\n电话：626-555-0100\n邮箱：amy@acme.com")).toBe(true);
    expect(text).toContain("乙方（客户）：Acme Trading LLC\n联系人：Amy Chen · 物流主管\n联系电话：626-555-0100\n联系邮箱：amy@acme.com\n授权签署人：________________"); // 没签时签署栏留空
    expect(text).toContain("乙方可在下单后 48 小时内申请取消");
    expect(text).not.toMatch(/\{(brand|company|companyAddress|customer|address|cancelHours|companyEmail|contactLine|phone|email)\}/);
  });

  it("签署后存档客户信息、签署人和条款原文；条款重要修改后要重新签署", () => {
    expect(terms.hasAcceptedTerms(cid)).toBe(false);
    terms.acceptTerms({ customerId: cid, party: terms.partyOf(db.getCustomer(cid)!), signer: "Amy Chen", signerTitle: "物流主管", lang: "zh", ip: "1.2.3.4", userAgent: "test" });
    expect(terms.hasAcceptedTerms(cid)).toBe(true);
    const a = terms.lastAcceptance(cid)!;
    expect(a).toMatchObject({ version: 1, signer: "Amy Chen", signerTitle: "物流主管", ip: "1.2.3.4" });
    expect(a.party).toMatchObject({ customer: "Acme Trading LLC", address: "100 Main St, Los Angeles, CA 90001", phone: "626-555-0100" });
    expect(a.text).toContain("Acme Trading LLC");
    expect(a.text).toMatch(/授权签署人：Amy Chen\n职位：物流主管\n签署日期：\d{4}-\d{2}-\d{2}$/);
    expect(terms.acceptedCount()).toBe(1);
    // 存档校验码和独立存档文件
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(terms.archiveIntact(a)).toBe(true);
    expect(terms.archiveIntact({ ...a, text: a.text + "x" })).toBe(false);
    const doc = terms.acceptanceDocument(a);
    expect(doc).toContain("电子签署记录");
    expect(doc).toContain(a.sha256!);
    expect(doc).toContain("授权签署人：Amy Chen");
    expect(terms.acceptanceFilename(a)).toMatch(/^Acme_Trading_LLC-v1-\d{4}-\d{2}-\d{2}-\d+\.html$/);
    expect(terms.allAcceptances()).toHaveLength(1);

    // 普通修改：不用重新签
    terms.saveTerms(terms.getTerms().zh + "\n补充说明", terms.getTerms().en, false);
    expect(terms.hasAcceptedTerms(cid)).toBe(true);
    // 重要修改：版本 +1，要重新签；旧的存档还在
    db.updateCustomerPortal(cid, { email: "amy@acme.com", enabled: true, creditLimit: 0 });
    expect(terms.unsignedCustomers()).toHaveLength(0);
    terms.saveTerms(terms.getTerms().zh, terms.getTerms().en, true, "补差规则调整");
    expect(terms.getTerms()).toMatchObject({ version: 2, changeNote: "补差规则调整" });
    expect(terms.hasAcceptedTerms(cid)).toBe(false);
    expect(terms.lastAcceptance(cid)!.version).toBe(1);
    expect(terms.acceptedCount()).toBe(0);
    expect(terms.unsignedCustomers()).toEqual([expect.objectContaining({ id: cid, signedVersion: 1 })]);
    // 重新签署后两版都有存档
    terms.acceptTerms({ customerId: cid, party: terms.partyOf(db.getCustomer(cid)!), signer: "Amy Chen", signerTitle: "物流主管", lang: "zh", ip: null, userAgent: null });
    expect(terms.listAcceptances(cid).map((x) => x.version)).toEqual([2, 1]);
    expect(terms.unsignedCustomers()).toHaveLength(0);
  });
});

describe("服务条款：换行符和旧版默认条款", () => {
  it("后台保存时带 \\r\\n 的默认条款不会被当成自定义；存着旧版默认条款的直接换成最新默认", async () => {
    const terms = await import("@/lib/terms");
    const db = await import("@/lib/db");
    terms.saveTerms(terms.DEFAULT_TERMS_ZH.replace(/\n/g, "\r\n"), terms.DEFAULT_TERMS_EN.replace(/\n/g, "\r\n"), false);
    expect(terms.usingDefaultTerms()).toBe(true);
    // 旧版（第一版）默认条款被存成了自定义
    const old = "本服务条款由 {company}（{brand} 平台运营方，以下简称“我们”）与 {customer}（以下简称“您”）签订。";
    db.saveSettings({ terms: { zh: old, en: "", version: 3, updatedAt: "", changeNote: "" } });
    expect(terms.usingDefaultTerms()).toBe(false); // 这段不是任何版本的完整默认条款：算自定义
    expect(terms.getTerms().zh).toBe(old);
  });
});
