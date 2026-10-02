/**
 * ShipGrid（SG）：https://shipgrid.ai/api/v1，Bearer 密钥认证。
 * 密钥 ak_test_… 是测试环境（不真实出单），ak_live_… 是正式环境。
 * 出单流程：POST /rates 查价 → POST /labels 建草稿 → POST /labels/{id}/purchase 购买（从 SG 钱包扣钱）。
 * 这一版先做连接和测试；查价、出单在 SG 开通 API 套餐后接上。
 */
import { getSettings } from "../db";

export const SG_BASE = "https://shipgrid.ai/api/v1";

export function shipgridSettings() {
  return getSettings().shipgrid ?? { enabled: false, apiKey: "" };
}

export const sgKeyMode = (key: string): "test" | "live" | null => (key.startsWith("ak_test_") ? "test" : key.startsWith("ak_live_") ? "live" : null);

/** 后台显示用：只露出前缀和最后 4 位 */
export const maskKey = (key: string) => (key ? `${key.slice(0, 8)}…${key.slice(-4)}` : "");

export class ShipGridError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function sgRequest<T>(path: string, init: { method?: string; body?: unknown; key?: string } = {}): Promise<T> {
  const key = init.key ?? shipgridSettings().apiKey;
  if (!key) throw new ShipGridError(0, "NO_KEY", "还没有填写 ShipGrid 密钥");
  const res = await fetch(SG_BASE + path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${key}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* 不是 JSON */
  }
  const err = (data as { error?: { code?: string; message?: string } | string; code?: string } | null)?.error;
  if (!res.ok || (data as { object?: string } | null)?.object === "Error") {
    const code = typeof err === "object" ? err?.code ?? "" : (data as { code?: string } | null)?.code ?? "";
    const msg = typeof err === "object" ? err?.message ?? "" : typeof err === "string" ? err : text.slice(0, 200);
    throw new ShipGridError(res.status, code || String(res.status), msg || `HTTP ${res.status}`);
  }
  return data as T;
}

export interface SgAccount {
  name: string;
  email: string;
  organization?: { name: string };
  balance?: { available: number; pending: number; reserved: number; currency: string; partner_funded?: number; parcel_spendable?: number };
}
export interface SgCarrierAccount {
  id: string;
  carrier: string;
  account_type: string;
  is_active: boolean;
  capabilities: string[];
}

/** 测试连接：账户、钱包、开通的物流商，以及查价权限有没有开（只查价，不建面单） */
export async function shipgridStatus(key?: string) {
  const account = await sgRequest<SgAccount>("/account", { key });
  const carriers = (await sgRequest<{ data: SgCarrierAccount[] }>("/carrier-accounts", { key })).data ?? [];
  // SG 自己报告的环境（测试密钥应该是 test；返回 production 要提醒，避免误以为是测试）
  const mode = await sgRequest<{ mode?: string }>("/labels?limit=1", { key }).then((r) => r.mode ?? null).catch(() => null);
  let rates: { ok: true; count: number } | { ok: false; code: string; message: string };
  try {
    const st = getSettings();
    const from = st.sender;
    const r = await sgRequest<{ object: string; data?: unknown[] }>("/rates", {
      key,
      body: {
        from_address: { name: "Test", street1: from?.address1 || "13950 Central Ave", city: from?.city || "Chino", state: from?.province || "CA", zip: from?.zipCode || "91710", country: "US" },
        to_address: { name: "Test", street1: "500 Congress Ave", city: "Austin", state: "TX", zip: "78701", country: "US" },
        parcel: { length: 10, width: 8, height: 4, weight: 1, weight_unit: "lb", dimension_unit: "in" },
      },
    });
    rates = { ok: true, count: Array.isArray(r.data) ? r.data.length : 0 };
  } catch (e) {
    const x = e as ShipGridError;
    rates = { ok: false, code: x.code ?? "", message: x.message };
  }
  return { account, carriers, rates, mode };
}
