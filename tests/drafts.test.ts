import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-drafts-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

describe("下单草稿", () => {
  let drafts: typeof import("@/lib/drafts");
  let a: number;
  let b: number;
  beforeAll(async () => {
    const db = await import("@/lib/db");
    drafts = await import("@/lib/drafts");
    const c = { contact: null, phone: null, email: null, note: null, markup: {} };
    a = db.saveCustomer(null, { name: "A", ...c });
    b = db.saveCustomer(null, { name: "B", ...c });
  });

  it("保存填了一半的订单，再打开内容一样；更新不新增；列表按最近保存排", () => {
    const req = { sender: { nameFirst: "Amy" }, recipient: { nameFirst: "Jane", nameLast: "Roe", city: "Austin" }, pkg: { length: 10 }, skuList: [{ sku: "TS-1" }] };
    const id = drafts.saveDraft(a, { intl: false, request: req as never, customerRef: "SO-1", remark: "易碎" });
    const d = drafts.getDraft(a, id)!;
    expect(d).toMatchObject({ intl: false, title: "SO-1 · Jane Roe · Austin", customerRef: "SO-1", remark: "易碎", request: req });
    expect(drafts.saveDraft(a, { id, intl: true, request: { ...req, recipient: { nameFirst: "Li" } } as never })).toBe(id);
    expect(drafts.getDraft(a, id)).toMatchObject({ intl: true, title: "Li" });
    const id2 = drafts.saveDraft(a, { intl: false, request: {} as never });
    expect(drafts.getDraft(a, id2)!.title).toBe("未填收件人");
    // 结构不对的内容也能存，打开时地址 / 包裹 / 商品结构完整
    expect(drafts.getDraft(a, id2)!.request).toEqual({ sender: {}, recipient: {}, pkg: {}, skuList: [] });
    expect(drafts.listDrafts(a).map((x) => x.id)).toContain(id2);
    expect(drafts.listDrafts(a, true).map((x) => x.id)).toEqual([id]);
    expect(drafts.draftRows(a, { us: "/u", intl: "/i" }).find((r) => r.id === id)!.href).toBe(`/i?draft=${id}`);
  });

  it("别的客户看不到、改不了、删不掉；改别人的草稿 id 会新建一份自己的", () => {
    const id = drafts.saveDraft(a, { intl: false, request: { recipient: { nameFirst: "X" } } as never });
    expect(drafts.getDraft(b, id)).toBeNull();
    expect(drafts.deleteDraft(b, id)).toBe(false);
    const mine = drafts.saveDraft(b, { id, intl: false, request: { recipient: { nameFirst: "Hack" } } as never });
    expect(mine).not.toBe(id);
    expect(drafts.getDraft(a, id)!.title).toBe("X");
    expect(drafts.deleteDraft(a, id)).toBe(true);
    expect(drafts.getDraft(a, id)).toBeNull();
  });

  it("太大的内容、超过 50 个都拒绝", () => {
    expect(() => drafts.saveDraft(b, { intl: false, request: { recipient: { nameFirst: "x".repeat(70_000) } } as never })).toThrow(/太多/);
    for (let i = drafts.listDrafts(b).length; i < drafts.MAX_DRAFTS; i++) drafts.saveDraft(b, { intl: false, request: {} as never });
    expect(() => drafts.saveDraft(b, { intl: false, request: {} as never })).toThrow(/50/);
  });
});
