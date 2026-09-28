/**
 * 服务商反馈记录：每张面单向服务商（ShipBest / 嘉谷）下单、查面单、取消时对方回了什么。
 * 出单异常时，后台在面单详情里能看到完整经过，方便拿去和服务商沟通。
 * 同一个动作连续返回一样的内容只记一条，更新次数和最后时间（后台每分钟自动刷新，避免刷屏）。
 */
import { db } from "./db";

export interface ProviderEvent {
  id: number;
  customNo: string;
  provider: string;
  action: string;
  code: string | null;
  message: string;
  times: number;
  firstAt: string;
  lastAt: string;
}

// 按数据库连接记：切换正式 / 测试环境、恢复备份后换了数据库文件，要重新建表
let ready: unknown = null;
function conn() {
  const c = db();
  if (ready !== c) {
    c.exec(`CREATE TABLE IF NOT EXISTS provider_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      custom_no TEXT NOT NULL,
      provider TEXT NOT NULL,
      action TEXT NOT NULL,
      code TEXT,
      message TEXT NOT NULL DEFAULT '',
      times INTEGER NOT NULL DEFAULT 1,
      first_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS provider_events_no ON provider_events (custom_no, id);`);
    ready = c;
  }
  return c;
}

export function logProviderEvent(customNo: string, provider: string, action: string, code: string | number | null | undefined, message: string | null | undefined) {
  if (!customNo) return;
  try {
    const c = conn();
    const codeStr = code === null || code === undefined || code === "" ? null : String(code);
    const msg = (message ?? "").slice(0, 1000);
    const last = c
      .prepare("SELECT id, code, message FROM provider_events WHERE custom_no = ? AND action = ? ORDER BY id DESC LIMIT 1")
      .get(customNo, action) as { id: number; code: string | null; message: string } | undefined;
    if (last && last.code === codeStr && last.message === msg) {
      c.prepare("UPDATE provider_events SET times = times + 1, last_at = datetime('now') WHERE id = ?").run(last.id);
    } else {
      c.prepare("INSERT INTO provider_events (custom_no, provider, action, code, message) VALUES (?, ?, ?, ?, ?)").run(customNo, provider, action, codeStr, msg);
    }
  } catch {
    // 记录失败不影响下单 / 查询
  }
}

export function listProviderEvents(customNo: string): ProviderEvent[] {
  return (
    conn().prepare("SELECT * FROM provider_events WHERE custom_no = ? ORDER BY id").all(customNo) as {
      id: number; custom_no: string; provider: string; action: string; code: string | null; message: string; times: number; first_at: string; last_at: string;
    }[]
  ).map((r) => ({ id: r.id, customNo: r.custom_no, provider: r.provider, action: r.action, code: r.code, message: r.message, times: r.times, firstAt: r.first_at, lastAt: r.last_at }));
}

export function deleteProviderEvents(customNos: string[]) {
  const del = conn().prepare("DELETE FROM provider_events WHERE custom_no = ?");
  for (const n of customNos) del.run(n);
}
