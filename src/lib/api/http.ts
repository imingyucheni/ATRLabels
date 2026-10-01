/** 开放 API 的公共处理：鉴权、频率限制、统一返回格式、调用记录 */
import { authenticate, logCall, rateLimit, type ApiKey } from "./keys";
import { ApiError } from "./v1";
import { publicBase } from "../stores/web";
import { translateMessage } from "../i18n";

type Handler = (key: ApiKey, ctx: { base: string; req: Request }) => Promise<unknown>;

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });

/** 统一格式：{ success, code, message, data }（ERP 对接物流商时最常见的写法） */
export const ok = (data: unknown) => json(200, { success: true, code: "OK", message: "ok", data });
const fail = (status: number, code: string, message: string, details?: unknown, extra?: Record<string, string>) =>
  json(status, { success: false, code, message, ...(details !== undefined ? { details } : {}) }, extra);

export function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}

export async function readJson<T>(req: Request): Promise<T> {
  const text = await req.text();
  if (text.length > 1_000_000) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "请求内容太大");
  if (!text.trim()) return {} as T;
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as T;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "请求内容不是有效的 JSON 对象");
  }
}

export async function handle(req: Request, fn: Handler): Promise<Response> {
  const t0 = Date.now();
  // 提示语言：Accept-Language 以 en 开头时返回英文（code 不变，程序按 code 判断）
  const en = /^en/i.test(req.headers.get("accept-language") ?? "");
  const tr = (m: string) => (en ? translateMessage("en", m) : m);
  const ip = clientIp(req);
  const path = new URL(req.url).pathname;
  const auth = authenticate(req.headers, ip);
  if (!auth.ok) {
    logCall({ keyId: null, customerId: null, method: req.method, path, status: auth.status, code: auth.code, message: auth.message, ms: Date.now() - t0, ip });
    return fail(auth.status, auth.code, tr(auth.message));
  }
  const key = auth.key;
  const wait = rateLimit(key.id);
  if (wait) {
    logCall({ keyId: key.id, customerId: key.customerId, method: req.method, path, status: 429, code: "RATE_LIMITED", ms: Date.now() - t0, ip });
    return fail(429, "RATE_LIMITED", en ? `Too many requests, retry in ${wait}s` : `调用太频繁，请 ${wait} 秒后再试`, undefined, { "Retry-After": String(wait) });
  }
  let res: Response;
  let code = "OK";
  let message: string | null = null;
  try {
    // 正常请求都有 Host；没有时（例如内部调用）用请求网址的域名
    const base = req.headers.get("host") || process.env.APP_URL || process.env.OMS_URL ? publicBase(req) : new URL(req.url).origin;
    const out = await fn(key, { base, req });
    res = out instanceof Response ? out : ok(out);
  } catch (e) {
    if (e instanceof ApiError) {
      code = e.code;
      message = e.message;
      res = fail(e.status, e.code, tr(e.message), e.details);
    } else {
      code = "INTERNAL";
      message = (e as Error).message;
      console.error("[api]", path, e);
      res = fail(500, "INTERNAL", en ? "Internal error, please retry later" : "服务器内部错误，请稍后重试");
    }
  }
  logCall({ keyId: key.id, customerId: key.customerId, method: req.method, path, status: res.status, code, message, ms: Date.now() - t0, ip });
  return res;
}
