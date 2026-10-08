/**
 * 开放 API：客户的 API 密钥、开放范围、调用记录、频率限制。
 * 密钥只在生成时显示一次；数据库里只存 SHA-256 摘要（密钥是 32 位随机串，摘要查不回原文）。
 */
import { createHash, randomBytes } from "node:crypto";
import { db, getCustomer } from "../db";

export type KeyMode = "live" | "test";

export interface ApiKey {
  id: number;
  customerId: number;
  name: string;
  mode: KeyMode;
  /** 显示用：atr_live_AbCd…（前 12 位） */
  prefix: string;
  /** 只允许这些 IP 调用（空 = 不限制） */
  ipAllow: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

let ready: unknown = null;
function conn() {
  const c = db();
  if (ready !== c) {
    c.exec(`CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'live',
      prefix TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      ip_allow TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS api_access (
      customer_id INTEGER PRIMARY KEY,
      enabled_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS api_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_id INTEGER,
      customer_id INTEGER,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status INTEGER NOT NULL,
      code TEXT,
      message TEXT,
      ms INTEGER,
      ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS api_logs_customer ON api_logs (customer_id, id);`);
    ready = c;
  }
  return c;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

interface KeyRow { id: number; customer_id: number; name: string; mode: KeyMode; prefix: string; ip_allow: string | null; created_at: string; last_used_at: string | null; revoked_at: string | null }
const toKey = (r: KeyRow): ApiKey => ({
  id: r.id, customerId: r.customer_id, name: r.name, mode: r.mode, prefix: r.prefix,
  ipAllow: r.ip_allow ? r.ip_allow.split(",").filter(Boolean) : [], createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at,
});

/* ---------------- 开放范围（测试阶段：后台逐个客户开放） ---------------- */

export function apiEnabled(customerId: number): boolean {
  return !!conn().prepare("SELECT 1 FROM api_access WHERE customer_id = ?").get(customerId);
}

export function setApiEnabled(customerId: number, on: boolean) {
  if (on) conn().prepare("INSERT OR IGNORE INTO api_access (customer_id) VALUES (?)").run(customerId);
  else conn().prepare("DELETE FROM api_access WHERE customer_id = ?").run(customerId);
}

/* ---------------- 密钥 ---------------- */

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function randomToken(n = 32) {
  const bytes = randomBytes(n);
  return Array.from(bytes, (b) => B62[b % 62]).join("");
}

/** IP 白名单：逗号 / 空格 / 换行分隔，只收 IPv4 / IPv6 */
export function parseIpAllow(raw: string): string[] {
  const list = raw.split(/[\s,，;；]+/).map((s) => s.trim()).filter(Boolean);
  for (const ip of list) if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && !(/^[0-9a-fA-F:]+$/.test(ip) && ip.includes(":"))) throw new Error(`IP 地址格式不对：${ip}`);
  return [...new Set(list)].slice(0, 20);
}

/** 生成新密钥：返回完整密钥（只这一次能看到） */
export function createKey(customerId: number, input: { name?: string; mode: KeyMode; ipAllow?: string }): { key: ApiKey; token: string } {
  const active = listKeys(customerId).filter((k) => !k.revokedAt).length;
  if (active >= 10) throw new Error("最多保留 10 个有效密钥，请先作废不用的");
  const token = `atr_${input.mode}_${randomToken()}`;
  const ips = input.ipAllow ? parseIpAllow(input.ipAllow) : [];
  const id = Number(
    conn()
      .prepare("INSERT INTO api_keys (customer_id, name, mode, prefix, hash, ip_allow) VALUES (?,?,?,?,?,?)")
      .run(customerId, (input.name ?? "").trim().slice(0, 40) || (input.mode === "test" ? "测试密钥" : "正式密钥"), input.mode, token.slice(0, 12), sha(token), ips.join(",") || null).lastInsertRowid,
  );
  return { key: getKey(id)!, token };
}

export function getKey(id: number): ApiKey | null {
  const r = conn().prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as KeyRow | undefined;
  return r ? toKey(r) : null;
}

export function listKeys(customerId: number): ApiKey[] {
  return (conn().prepare("SELECT * FROM api_keys WHERE customer_id = ? ORDER BY revoked_at IS NOT NULL, id DESC").all(customerId) as KeyRow[]).map(toKey);
}

export function revokeKey(id: number, customerId?: number) {
  const k = getKey(id);
  if (!k || (customerId && k.customerId !== customerId)) throw new Error("密钥不存在");
  conn().prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").run(id);
}

export function setKeyIps(id: number, customerId: number, raw: string) {
  const k = getKey(id);
  if (!k || k.customerId !== customerId) throw new Error("密钥不存在");
  conn().prepare("UPDATE api_keys SET ip_allow = ? WHERE id = ?").run(parseIpAllow(raw).join(",") || null, id);
}

export const ACCOUNT_DISABLED_MESSAGE = "公司自用账户不能使用 API";

export type AuthResult = { ok: true; key: ApiKey } | { ok: false; status: number; code: string; message: string };

/** 校验请求带的密钥（Authorization: Bearer … 或 X-Api-Key: …） */
export function authenticate(headers: { get(name: string): string | null }, ip: string | null): AuthResult {
  const auth = headers.get("authorization") ?? "";
  const token = (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : headers.get("x-api-key") ?? "").trim();
  if (!token) return { ok: false, status: 401, code: "UNAUTHORIZED", message: "缺少 API 密钥：请在请求头加 Authorization: Bearer <密钥>" };
  const r = conn().prepare("SELECT * FROM api_keys WHERE hash = ?").get(sha(token)) as KeyRow | undefined;
  if (!r || r.revoked_at) return { ok: false, status: 401, code: "UNAUTHORIZED", message: "API 密钥无效或已作废" };
  const key = toKey(r);
  // 公司自用账户（成本价、不扣余额）不能用 API。
  // API 有自己的开关（后台客户详情 → 开放 API），和客户端登录分开：只用 API、不登录客户中心的客户照常能用
  const c = getCustomer(key.customerId);
  if (!c) return { ok: false, status: 401, code: "UNAUTHORIZED", message: "API 密钥无效或已作废" };
  if (c.internal) return { ok: false, status: 403, code: "API_DISABLED", message: ACCOUNT_DISABLED_MESSAGE };
  if (!apiEnabled(key.customerId)) return { ok: false, status: 403, code: "API_DISABLED", message: "这个账户的 API 还没有开通，请联系客服" };
  if (key.ipAllow.length && (!ip || !key.ipAllow.includes(ip))) return { ok: false, status: 403, code: "IP_NOT_ALLOWED", message: `这个密钥不允许从 ${ip ?? "未知 IP"} 调用` };
  conn().prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(key.id);
  return { ok: true, key };
}

/* ---------------- 频率限制（每个密钥每分钟） ---------------- */

const g = globalThis as unknown as { __apiRate?: Map<number, number[]> };
const hits: Map<number, number[]> = (g.__apiRate ??= new Map());
export const RATE_PER_MIN = 60;

/** 记一次调用；超过限制返回需要等待的秒数 */
export function rateLimit(keyId: number, now = Date.now()): number {
  const list = (hits.get(keyId) ?? []).filter((t) => t > now - 60_000);
  if (list.length >= RATE_PER_MIN) {
    hits.set(keyId, list);
    return Math.max(1, Math.ceil((list[0] + 60_000 - now) / 1000));
  }
  list.push(now);
  hits.set(keyId, list);
  return 0;
}

/* ---------------- 调用记录 ---------------- */

/** 服务器内部错误：返回给调用方、记进客户能看到的调用记录的都是这句，原始报错只打在服务器日志里 */
export const INTERNAL_MESSAGE = "服务器内部错误，请稍后重试";

export interface ApiLog { id: number; keyId: number | null; method: string; path: string; status: number; code: string | null; message: string | null; ms: number | null; ip: string | null; createdAt: string; keyPrefix: string | null }

export function logCall(e: { keyId: number | null; customerId: number | null; method: string; path: string; status: number; code?: string | null; message?: string | null; ms: number; ip: string | null }) {
  const c = conn();
  c.prepare("INSERT INTO api_logs (key_id, customer_id, method, path, status, code, message, ms, ip) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(e.keyId, e.customerId, e.method, e.path.slice(0, 200), e.status, e.code ?? null, (e.message ?? "").slice(0, 300) || null, e.ms, e.ip);
  // 只留 30 天
  if (Math.random() < 0.01) c.prepare("DELETE FROM api_logs WHERE created_at < datetime('now', '-30 days')").run();
}

export function listLogs(customerId: number, limit = 100): ApiLog[] {
  return (conn()
    .prepare(`SELECT l.*, k.prefix AS key_prefix FROM api_logs l LEFT JOIN api_keys k ON k.id = l.key_id WHERE l.customer_id = ? ORDER BY l.id DESC LIMIT ?`)
    .all(customerId, limit) as Record<string, any>[]).map((r) => ({
    id: r.id, keyId: r.key_id, method: r.method, path: r.path, status: r.status, code: r.code, message: r.message, ms: r.ms, ip: r.ip, createdAt: r.created_at, keyPrefix: r.key_prefix,
  }));
}
