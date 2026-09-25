/**
 * 上线前清空测试数据：删掉所有订单、流水（余额随之归零）、充值申请、补差、批量导入记录和面单文件；
 * 保留客户、登录账号、渠道、价格设置、派送范围、报价表、寄件地址簿等配置。
 * 已经有正式订单时不允许清空（防止误删真实账目）。清空前自动备份数据库。
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir, db } from "./db";
import { createBackup } from "./backup";

/** 正式单：接口模式记为 live 的单；老数据没有记录模式时，有真实面单地址（不是 mock://）的也算 */
const LIVE_WHERE = "env = 'live' OR (env IS NULL AND label_url IS NOT NULL AND label_url NOT LIKE 'mock://%')";

export function testDataStats() {
  const conn = db();
  const n = (sql: string) => (conn.prepare(sql).get() as { n: number }).n;
  return {
    shipments: n("SELECT COUNT(*) AS n FROM shipments"),
    liveShipments: n(`SELECT COUNT(*) AS n FROM shipments WHERE ${LIVE_WHERE}`),
    ledger: n("SELECT COUNT(*) AS n FROM ledger"),
    topups: n("SELECT COUNT(*) AS n FROM topup_requests"),
    adjustments: n("SELECT COUNT(*) AS n FROM adjustments"),
    batches: n("SELECT COUNT(*) AS n FROM batch_jobs"),
  };
}

export function clearTestData(): { backup: string } {
  const stats = testDataStats();
  if (stats.liveShipments > 0) throw new Error(`已经有 ${stats.liveShipments} 张正式订单，不能清空（只能在上线前使用）`);
  const conn = db();
  // 先备份（数据库 + 面单等文件），可以在后台“数据备份”里恢复
  const backup = createBackup("before-clear");
  conn.transaction(() => {
    // 按外键依赖顺序删：充值申请 → 流水 → 补差 → 批量导入 → 订单
    for (const t of ["topup_requests", "ledger", "adjustments", "adjustment_batches", "batch_job_rows", "batch_jobs", "shipments"]) {
      conn.exec(`DELETE FROM ${t}`);
    }
    const hasMock = conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mock_orders'").get();
    if (hasMock) conn.exec("DELETE FROM mock_orders");
  })();

  // 面单文件、充值凭证
  for (const sub of ["labels", "topup"]) {
    const d = path.join(dataDir(), sub);
    if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) fs.rmSync(path.join(d, f), { recursive: true, force: true });
  }
  return { backup };
}
