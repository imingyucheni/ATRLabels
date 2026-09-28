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
    expect(text).toContain("Atronia Innovations Inc.（ATRShip 平台运营方，以下简称“我们”）与 Acme Trading LLC（以下简称“您”）");
    expect(text).toContain("客户：Acme Trading LLC\n地址：100 Main St, Los Angeles, CA 90001\n联系人：Amy Chen · 物流主管\n电话：626-555-0100");
    expect(text).toContain("服务方：Atronia Innovations Inc.（ATRShip 平台运营方）\n地址：3134 Friendswood Ave, El Monte, CA 91733");
    expect(text).toContain("下单后 48 小时内可以申请取消");
    expect(text).not.toMatch(/\{(brand|company|companyAddress|customer|address|cancelHours)\}/);
  });

  it("签署后存档客户信息、签署人和条款原文；条款重要修改后要重新签署", () => {
    expect(terms.hasAcceptedTerms(cid)).toBe(false);
    terms.acceptTerms({ customerId: cid, party: terms.partyOf(db.getCustomer(cid)!), signer: "Amy Chen", signerTitle: "物流主管", lang: "zh", ip: "1.2.3.4", userAgent: "test" });
    expect(terms.hasAcceptedTerms(cid)).toBe(true);
    const a = terms.lastAcceptance(cid)!;
    expect(a).toMatchObject({ version: 1, signer: "Amy Chen", signerTitle: "物流主管", ip: "1.2.3.4" });
    expect(a.party).toMatchObject({ customer: "Acme Trading LLC", address: "100 Main St, Los Angeles, CA 90001", phone: "626-555-0100" });
    expect(a.text).toContain("Acme Trading LLC");
    expect(terms.acceptedCount()).toBe(1);

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
