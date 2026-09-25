/**
 * 清除正式数据里的模拟 / 沙盒数据：只删不是真实下单的订单，以及跟这些订单绑定的扣款、退款、补差、
 * 批量导入记录和面单文件；真实订单和它们的账目一概不动，所以上线后也能随时用。
 * （切换到测试模式后产生的数据本来就存在单独的测试数据库里，不会进正式数据；这里清的是分开之前留下的。）
 * 充值、手动调账不属于某张订单，分不出是不是测试，保留不删。清除前自动备份。
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir, db } from "./db";
import { createBackup } from "./backup";

/** 正式单：接口模式记为 live 的单；老数据没有记录模式时，有真实面单地址（不是 mock://）的也算 */
// 用 COALESCE 保证结果只有真 / 假：否则 env、label_url 都为空的单既不算正式也不算测试
const LIVE_WHERE = "(COALESCE(env, '') = 'live' OR (env IS NULL AND COALESCE(label_url, '') <> '' AND label_url NOT LIKE 'mock://%'))";
const TEST_IDS = `SELECT id FROM shipments WHERE NOT ${LIVE_WHERE}`;
/** 没有任何一行对应正式单的批量导入 */
const TEST_JOBS = `SELECT j.id FROM batch_jobs j WHERE NOT EXISTS (
  SELECT 1 FROM batch_job_rows r JOIN shipments s ON s.id = r.shipment_id WHERE r.job_id = j.id AND ${LIVE_WHERE.replace(/\b(env|label_url)\b/g, "s.$1")})`;

function hasTable(name: string) {
  return !!db().prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

export function testDataStats() {
  const conn = db();
  const n = (sql: string) => (conn.prepare(sql).get() as { n: number }).n;
  return {
    shipments: n("SELECT COUNT(*) AS n FROM shipments"),
    liveShipments: n(`SELECT COUNT(*) AS n FROM shipments WHERE ${LIVE_WHERE}`),
    testShipments: n(`SELECT COUNT(*) AS n FROM shipments WHERE NOT ${LIVE_WHERE}`),
    testLedger: n(`SELECT COUNT(*) AS n FROM ledger WHERE shipment_id IN (${TEST_IDS})`),
    testAdjustments: n(`SELECT COUNT(*) AS n FROM adjustments WHERE shipment_id IN (${TEST_IDS})`),
    testBatches: n(`SELECT COUNT(*) AS n FROM batch_jobs WHERE id IN (${TEST_JOBS})`),
    mockOrders: hasTable("mock_orders") ? n("SELECT COUNT(*) AS n FROM mock_orders") : 0,
  };
}

export function hasTestData(st = testDataStats()) {
  return st.testShipments + st.testBatches + st.mockOrders > 0;
}

export function clearTestData(): { backup: string; removed: ReturnType<typeof testDataStats> } {
  const conn = db();
  const removed = testDataStats();
  if (!hasTestData(removed)) throw new Error("没有需要清除的模拟 / 沙盒数据");
  // 先备份（数据库 + 面单等文件），可以在后台“数据备份”里恢复
  const backup = createBackup("before-clear");
  const files = (conn.prepare(`SELECT label_path FROM shipments WHERE id IN (${TEST_IDS}) AND label_path IS NOT NULL`).all() as { label_path: string }[]).map((r) => r.label_path);
  conn.transaction(() => {
    // 按外键依赖顺序删：流水 → 补差 → 批量导入 → 订单
    conn.exec(`DELETE FROM ledger WHERE shipment_id IN (${TEST_IDS}) OR adjustment_id IN (SELECT id FROM adjustments WHERE shipment_id IN (${TEST_IDS}))`);
    conn.exec(`DELETE FROM adjustments WHERE shipment_id IN (${TEST_IDS})`);
    conn.exec("DELETE FROM adjustment_batches WHERE id NOT IN (SELECT batch_id FROM adjustments)");
    conn.exec(`DELETE FROM batch_job_rows WHERE job_id IN (${TEST_JOBS})`);
    conn.exec("DELETE FROM batch_jobs WHERE id NOT IN (SELECT job_id FROM batch_job_rows)");
    // 保留下来的批次里指向测试单的行（例如一个批次里既有测试单又有正式单）解除关联
    conn.exec(`UPDATE batch_job_rows SET shipment_id = NULL WHERE shipment_id IN (${TEST_IDS})`);
    conn.exec(`DELETE FROM shipments WHERE id IN (${TEST_IDS})`);
    if (hasTable("mock_orders")) conn.exec("DELETE FROM mock_orders");
  })();

  // 测试单的面单文件
  const root = path.resolve(dataDir());
  for (const f of files) {
    // label_path 是相对数据目录的路径（labels/xxx.pdf）
    const p = path.resolve(root, f);
    if (p.startsWith(root + path.sep)) fs.rmSync(p, { force: true });
  }
  return { backup, removed };
}
