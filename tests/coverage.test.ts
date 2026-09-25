import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipmentRequest } from "@/lib/shipbest/types";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "atr-cov-"));
process.env.SHIPBEST_MOCK = "1";

const req = (zip: string): ShipmentRequest => ({
  sender: { nameFirst: "W", nameLast: "H", country: "US", city: "Chino", address1: "1 Main St", zipCode: "91710", province: "CA" },
  recipient: { nameFirst: "J", nameLast: "D", country: "US", city: "X", address1: "2 Elm St", zipCode: zip, province: "NY" },
  pkg: { length: 10, width: 8, height: 4, weight: 1, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD" },
  skuList: [{ sku: "A1", productNameCn: "T恤", productNameEn: "T-shirt", quantity: 1, declaredUnitPrice: 5, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: 1, width: 1, height: 1, weight: 1, unit: 3 }],
});

/** 虚构的服务商邮编表：两种常见格式 */
async function workbook() {
  const wb = new ExcelJS.Workbook();
  // GOFO 格式：两层表头，口岸是单独的列，列里是分区
  const g = wb.addWorksheet("GOFO邮编");
  g.addRow(["GOFO邮编分区表"]);
  g.addRow(["序号", "目的地邮编", "大区", "省州", "城市", "注入口岸", "注入口岸"]);
  g.addRow(["序号", "目的地邮编", "大区", "省州", "城市", "LAX", "JFK"]);
  g.addRow([1, "90001", "WE", "CA", "LA", 1, 8]);
  g.addRow([2, 10001, "EA", "NY", "NY", "", 1]); // LAX 不覆盖
  g.addRow([3, "07001", "EA", "NJ", "Avenel", 8, 2]);
  // UNI 格式：一行一个口岸
  const u = wb.addWorksheet("UNI邮编");
  u.addRow(["说明：生效日期…"]);
  u.addRow(["Zip Code", "Gateway", "Service Area", "ZONE", "City"]);
  u.addRow([1001, "LAX", "EWR", 8, "Hampden"]); // 数字邮编要补 0
  u.addRow([10001, "JFK", "EWR", 2, "NY"]);
  wb.addWorksheet("GOFO").addRow(["价格表，不是邮编表"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("派送范围（邮编覆盖表）", () => {
  let cov: typeof import("@/lib/coverage");
  let db: typeof import("@/lib/db");
  let svc: typeof import("@/lib/service");
  beforeAll(async () => {
    cov = await import("@/lib/coverage");
    db = await import("@/lib/db");
    svc = await import("@/lib/service");
    await svc.syncChannels();
  });

  it("识别两层表头和按口岸筛选", async () => {
    const r = await cov.parseCoverageWorkbook("rates.xlsx", await workbook(), "LAX");
    expect(r.sheets.map((s) => s.sheet)).toEqual(["GOFO邮编", "UNI邮编"]);
    const [gofo, uni] = r.sheets;
    expect(gofo.count).toBe(2);
    expect(gofo.sample).toEqual(["90001", "07001"]);
    expect(uni.count).toBe(1);
    expect(uni.sample).toEqual(["01001"]);
    expect(gofo.guess).toBe("LP10210029");
    expect(uni.guess).toBe("LP10210028");
  });

  it("打开预筛后，试算前排除不在邮编表里的渠道，不影响没有邮编表的渠道", async () => {
    const r = await cov.parseCoverageWorkbook("rates.xlsx", await workbook(), "LAX");
    const done = cov.importCoverage(r.token, { "GOFO邮编": "LP10210029", "UNI邮编": "LP10210028" });
    expect(done).toEqual([{ channel: "LP10210029", count: 2 }, { channel: "LP10210028", count: 1 }]);
    expect(cov.coverageFor("LP10210029", "90001-1234")).toEqual({ covered: true, zone: "1" });
    expect(cov.coverageFor("LP10210029", "10001")).toEqual({ covered: false, zone: null });
    expect(cov.coverageFor("LP10210030", "10001")).toBeNull(); // USPS 没有邮编表

    // 默认只作参考：不预筛
    expect(cov.precheck("LP10210029", "10001")).toBeNull();
    cov.setPrefilter("LP10210029", true);
    cov.setPrefilter("LP10210028", true);
    const id = db.saveCustomer(null, { name: "覆盖客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(id, ["LP10210028", "LP10210029", "LP10210030"]);
    const quotes = await svc.quoteAll(id, req("10001"));
    const by = Object.fromEntries(quotes.map((q) => [q.channelCode, q]));
    expect(by.LP10210029.ok).toBe(false);
    expect(by.LP10210029.error).toContain("不在此渠道的派送范围");
    expect(by.LP10210028.ok).toBe(false);
    expect(by.LP10210030.ok).toBe(true);

    cov.removeCoverage("LP10210029");
    expect(cov.coverageFor("LP10210029", "10001")).toBeNull();
    expect(() => cov.importCoverage(r.token, {})).toThrow(/过期/);
  });

  it("接口回复不通邮后记住，下次不再调接口；能送时清除", async () => {
    const { getShipBestClient } = await import("@/lib/shipbest/client");
    const client = getShipBestClient();
    const id = db.saveCustomer(null, { name: "记忆客户", contact: null, phone: null, email: null, note: null, markup: {} });
    db.setCustomerChannels(id, ["LP10210030"]);
    let calls = 0;
    const orig = client.trialPrice.bind(client);
    client.trialPrice = async () => {
      calls++;
      throw new Error("[1] 国家[US],邮编[59901]不通邮");
    };
    const q1 = await svc.quoteAll(id, req("59901"));
    expect(q1[0].ok).toBe(false);
    expect(calls).toBe(1);
    expect(cov.blockedZip("LP10210030", "59901-0001")).not.toBeNull();
    const q2 = await svc.quoteAll(id, req("59901"));
    expect(q2[0].error).toContain("查询过");
    expect(calls).toBe(1); // 第二次没有调接口
    // 其他报错（网络等）不记
    client.trialPrice = async () => {
      calls++;
      throw new Error("timeout");
    };
    await svc.quoteAll(id, req("59902"));
    expect(cov.blockedZip("LP10210030", "59902")).toBeNull();
    // 清除后重新查询，能送就不再记
    client.trialPrice = orig;
    cov.clearBlocks("LP10210030");
    const q3 = await svc.quoteAll(id, req("59901"));
    expect(q3[0].ok).toBe(true);
    expect(cov.blockedZip("LP10210030", "59901")).toBeNull();
  });
});
