/**
 * 财务确认密码（4 位数字）：确认客户充值到账、手动充值 / 调账时要再输一次，防止误点或别人用已登录的电脑操作。
 * 在“设置 → 财务确认密码”设置；设置和修改都要输入管理员登录密码。
 * 连续输错 5 次锁定 30 分钟。
 */
import { getSettings, saveSettings } from "./db";
import { hashPassword, verifyPassword } from "./password";
import { verifyStaffPin } from "./staffStore";

const MAX_FAILS = 5;
const LOCK_MS = 30 * 60_000;
let fails = { count: 0, until: 0 };

export const isPin = (v: string) => /^\d{4}$/.test(v);

export function hasFinancePin() {
  return !!getSettings().financePin;
}

export function setFinancePin(pin: string) {
  if (!isPin(pin)) throw new Error("财务确认密码必须是 4 位数字");
  saveSettings({ financePin: hashPassword(pin) });
  fails = { count: 0, until: 0 };
}

/** 校验财务确认密码；通过返回 null，否则返回错误说明 */
export function checkFinancePin(pin: string | null | undefined): string | null {
  const stored = getSettings().financePin;
  if (!stored) return "请先在“设置 → 财务确认密码”里设置 4 位数字密码";
  const now = Date.now();
  if (fails.count >= MAX_FAILS && fails.until > now) return "财务确认密码输错次数过多，请 30 分钟后再试";
  if (fails.until <= now) fails = { count: 0, until: 0 };
  if (!pin || !verifyPassword(String(pin), stored)) {
    fails = { count: fails.count + 1, until: now + LOCK_MS };
    const left = MAX_FAILS - fails.count;
    return left > 0 ? `财务确认密码不正确（还可以再试 ${left} 次）` : "财务确认密码输错次数过多，请 30 分钟后再试";
  }
  fails = { count: 0, until: 0 };
  return null;
}

const staffFails = new Map<number, { count: number; until: number }>();

/**
 * 按登录的人校验确认密码：主管理员用“设置 → 财务确认密码”，员工用自己设的 4 位确认密码。
 * 通过返回 null，否则返回错误说明。
 */
export function checkConfirmPin(who: { role: "owner" | "staff"; id: number }, pin: string | null | undefined): string | null {
  if (who.role === "owner") return checkFinancePin(pin);
  const now = Date.now();
  const f = staffFails.get(who.id) ?? { count: 0, until: 0 };
  if (f.count >= MAX_FAILS && f.until > now) return "确认密码输错次数过多，请 30 分钟后再试";
  const ok = verifyStaffPin(who.id, String(pin ?? ""));
  if (ok === null) return "请先在“我的账号”里设置你的 4 位确认密码";
  if (!ok) {
    const next = { count: (f.until > now ? f.count : 0) + 1, until: now + LOCK_MS };
    staffFails.set(who.id, next);
    const left = MAX_FAILS - next.count;
    return left > 0 ? `确认密码不正确（还可以再试 ${left} 次）` : "确认密码输错次数过多，请 30 分钟后再试";
  }
  staffFails.delete(who.id);
  return null;
}
