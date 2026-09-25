/**
 * 刚生成的客户登录密码：只在后台“客户详情”页显示一段时间（15 分钟），方便复制发给客户。
 * 密码本身只存哈希，这里的明文只在内存里，服务重启或过期后就看不到了（可以重新生成）。
 */
import { randomInt } from "node:crypto";

interface Pending {
  email: string;
  password: string;
  expires: number;
}

const g = globalThis as unknown as { __pendingCreds?: Map<number, Pending> };
const pending = (g.__pendingCreds ??= new Map());

/** 生成易读的初始密码（去掉 0/O、1/l/I 等容易看错的字符） */
export function readablePassword(len = 10) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () => chars[randomInt(chars.length)]).join("");
}

export function rememberCredentials(customerId: number, email: string, password: string) {
  pending.set(customerId, { email, password, expires: Date.now() + 15 * 60_000 });
}

export function pendingCredentials(customerId: number): { email: string; password: string } | null {
  const p = pending.get(customerId);
  if (!p) return null;
  if (p.expires < Date.now()) {
    pending.delete(customerId);
    return null;
  }
  return { email: p.email, password: p.password };
}

export function clearCredentials(customerId: number) {
  pending.delete(customerId);
}
