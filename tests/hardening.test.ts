import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-hard-"));
process.env.ATR_SINGLE_DB = "1";
process.env.SHIPBEST_MOCK = "1";

const req: ShipmentRequest = {
  sender: { nameFirst: "Ware", nameLast: "House", country: "US", city: "Los Angeles", address1: "1 Main St", zipCode: "90058", province: "CA", phone: "9095550100" },
  recipient: { nameFirst: "Jason", nameLast: "Menard", country: "US", city: "Omaha", address1: "2 Elm St", zipCode: "68104", province: "NE" },
  pkg: { length: 10, width: 8, height: 4, weight: 1, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "A1", productNameCn: "T恤", productNameEn: "T-shirt", quantity: 1, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 10, width: 8, height: 4, weight: 1, unit: 3 }],
};

describe("安全检查修复", () => {
  let db: typeof import("@/lib/db");
  let svc: typeof import("@/lib/service");
  let ledger: typeof import("@/lib/ledger");
  let sb: typeof import("@/lib/shipbest/client");
  let cid: number;

  beforeAll(async () => {
    db = await import("@/lib/db");
    svc = await import("@/lib/service");
    ledger = await import("@/lib/ledger");
    sb = await import("@/lib/shipbest/client");
    await svc.syncChannels();
    cid = db.saveCustomer(null, { name: "加固客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(cid, db.listChannels().map((c) => c.code));
    ledger.addLedger({ customerId: cid, type: "topup", amount: 100, createdBy: "admin" });
  });

  async function order(ref: string) {
    const q = (await svc.quoteAll(cid, req)).find((x) => x.ok)!;
    return svc.createLabel({ customerId: cid, channelCode: q.channelCode, req, expectedPrice: q.price!, customerRef: ref, waitForLabel: false });
  }

  it("已取消并退款的单，刷新时服务商还显示已出面单：不会变回已出单，只提示核实", async () => {
    const id = await order("H-1");
    const client = sb.getShipBestClient();
    const orig = client.cancelOrder.bind(client);
    client.cancelOrder = async () => { throw new sb.ShipBestError(11203, "nonsupport"); };
    try {
      await svc.requestCancel(id);
    } finally {
      client.cancelOrder = orig;
    }
    expect(db.getShipment(id)!.status).toBe("cancel_requested");
    svc.confirmCancelled(id, 0, 0);
    const bal = ledger.balanceOf(cid);
    const origGet = client.getOrder.bind(client);
    client.getOrder = async (k) => ({ ...(await origGet(k)), status: 4 });
    try {
      await svc.refreshShipment(id);
    } finally {
      client.getOrder = origGet;
    }
    const s = db.getShipment(id)!;
    expect(s.status).toBe("cancelled");
    expect(s.errorMsg).toContain("核实");
    expect(ledger.balanceOf(cid)).toBe(bal);
  });

  it("确认取消：只能用于取消处理中的单，取消费不能是负数或超过客户价", async () => {
    const id = await order("H-2");
    expect(() => svc.confirmCancelled(id, 0, 0)).toThrow(/不在取消处理中/);
    db.updateShipment(id, { status: "cancel_requested" });
    const price = db.getShipment(id)!.price;
    expect(() => svc.confirmCancelled(id, -50, 0)).toThrow(/0 到客户价/);
    expect(() => svc.confirmCancelled(id, price + 1, 0)).toThrow(/0 到客户价/);
    expect(() => svc.confirmCancelled(id, 0, -1)).toThrow(/负数/);
    svc.confirmCancelled(id, 0, 0);
    expect(() => svc.confirmCancelled(id, 0, 0)).toThrow(/不在取消处理中/); // 不能重复确认
  });

  it("服务商返回非 JSON（网关超时）：保留订单等刷新，不删单退款", async () => {
    const client = sb.getShipBestClient();
    const orig = client.createOrder.bind(client);
    client.createOrder = async () => { throw new Error("ShipBest 接口返回异常（HTTP 504）<html>"); };
    try {
      const id = await order("H-3");
      expect(db.getShipment(id)).toMatchObject({ status: "pending" });
      expect(db.getShipment(id)!.errorMsg).toContain("提交结果未知");
    } finally {
      client.createOrder = orig;
    }
  });

  it("CSV 导出：开头是 = + - @ Tab 的内容不会被 Excel 当公式", async () => {
    const { csvCell } = await import("@/lib/csv");
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("\t=1+1")).toBe("'\t=1+1");
    expect(csvCell("-12.5")).toBe("-12.5");
  });

  it("上传的 xlsx 解压后过大（压缩炸弹）直接拒绝，正常文件通过", async () => {
    const { assertZipSize, zipStore } = await import("@/lib/zip");
    const ok = zipStore([{ name: "a.txt", data: new TextEncoder().encode("hello") }]);
    expect(() => assertZipSize(ok)).not.toThrow();
    expect(() => assertZipSize(ok, 3)).toThrow(/太多/);
    expect(() => assertZipSize(Buffer.from("not a zip at all, definitely not"))).toThrow(/格式不对/);
  });
});
