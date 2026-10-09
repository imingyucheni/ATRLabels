/**
 * 二级管理员（员工账号）：可以开客户账号、设置客户邮费（渠道和加价，不能低于全局默认）、确认客户充值，
 * 在“我的看板”看自己负责的客户的消费、成本、利润和自己的提成。看不到其他客户、报表、系统设置。
 *
 * 存在数据目录的 staff.json（不放数据库）：
 * - 账号是全站的，不分正式 / 测试数据；
 * - 登录检查（proxy）只需要读这个小文件，不用打开数据库。
 * 密码和 4 位确认密码都只存哈希。ver 是会话版本：改密码、停用、删除时换掉，之前的登录立即失效。
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "./password";

/**
 * 员工能看哪些客户、能不能操作：
 * - all：全部客户（包括以后新增的）都能看能操作，customers 里可以单独把某些客户设成 view（只能看）或 none（看不到）
 * - list：只能看列出来的客户，customers 里每个客户 view（只能看）或 edit（能看也能操作：改资料、设置邮费、确认充值）
 * 员工自己新建的客户自动加进他的名单（能操作）。
 */
export type AccessLevel = "view" | "edit";
export type AccessSetting = AccessLevel | "none";
export interface StaffAccess {
  mode: "all" | "list";
  customers: Record<string, AccessSetting>;
}

export interface StaffAccount {
  id: number;
  name: string;
  username: string;
  pwHash: string;
  pinHash: string | null;
  active: boolean;
  ver: string;
  createdAt: string;
  lastLoginAt: string | null;
  /** 没有这个字段的（第一版建的账号）= 全部客户 */
  access?: StaffAccess;
}

/** 页面上用的（不带哈希） */
export type StaffPublic = Omit<StaffAccount, "pwHash" | "pinHash"> & { hasPin: boolean };

const file = () => path.join(path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "./data"), "staff.json");
let cache: { mtime: number; file: string; list: StaffAccount[] } | null = null;

function load(): StaffAccount[] {
  const f = file();
  let mtime = 0;
  try {
    mtime = fs.statSync(f).mtimeMs;
  } catch {
    return [];
  }
  if (cache && cache.file === f && cache.mtime === mtime) return cache.list;
  try {
    const list = JSON.parse(fs.readFileSync(f, "utf8")) as StaffAccount[];
    cache = { mtime, file: f, list: Array.isArray(list) ? list : [] };
  } catch {
    cache = { mtime, file: f, list: [] };
  }
  return cache.list;
}

function save(list: StaffAccount[]) {
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, f);
  cache = null;
}

const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const newVer = () => randomBytes(8).toString("hex");
const toPublic = (s: StaffAccount): StaffPublic => {
  const { pwHash: _p, pinHash, ...rest } = s;
  void _p;
  return { ...rest, hasPin: !!pinHash };
};

export function listStaff(): StaffPublic[] {
  return load().map(toPublic);
}

export function getStaff(id: number): StaffAccount | null {
  return load().find((s) => s.id === id) ?? null;
}

/** 登录检查用：账号存在、没停用、会话版本对得上 */
export function staffSessionValid(id: number, ver: string): StaffAccount | null {
  const s = getStaff(id);
  return s && s.active && s.ver === ver ? s : null;
}

const USERNAME = /^[a-z0-9._-]{3,32}$/;

function checkPassword(pw: string) {
  if (pw.length < 8) throw new Error("密码至少 8 位");
}

export function createStaff(input: { name: string; username: string; password: string }): number {
  const list = load();
  const name = input.name.trim();
  const username = input.username.trim().toLowerCase();
  if (!name) throw new Error("请填写姓名");
  if (!USERNAME.test(username)) throw new Error("登录名用 3–32 位小写字母、数字、点、横杠或下划线");
  if (username === "admin") throw new Error("admin 是保留的登录名，请换一个");
  if (list.some((s) => s.username === username)) throw new Error("这个登录名已经有人用了");
  checkPassword(input.password);
  const id = Math.max(0, ...list.map((s) => s.id)) + 1;
  // 新员工默认一个客户都看不到，由主管理员授权
  save([...list, { id, name, username, pwHash: hashPassword(input.password), pinHash: null, active: true, ver: newVer(), createdAt: now(), lastLoginAt: null, access: { mode: "list", customers: {} } }]);
  return id;
}

function update(id: number, fn: (s: StaffAccount) => StaffAccount) {
  const list = load();
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) throw new Error("管理员账号不存在");
  const next = [...list];
  next[i] = fn({ ...list[i] });
  save(next);
}

export function renameStaff(id: number, name: string) {
  if (!name.trim()) throw new Error("请填写姓名");
  update(id, (s) => ({ ...s, name: name.trim() }));
}

/** 停用 / 启用；停用时之前的登录立即失效 */
export function setStaffActive(id: number, active: boolean) {
  update(id, (s) => ({ ...s, active, ver: active ? s.ver : newVer() }));
}

/** 改密码（主管理员重置，或员工自己改）；其他设备上的登录失效 */
export function setStaffPassword(id: number, password: string) {
  checkPassword(password);
  update(id, (s) => ({ ...s, pwHash: hashPassword(password), ver: newVer() }));
}

export function deleteStaff(id: number) {
  const list = load();
  if (!list.some((s) => s.id === id)) throw new Error("管理员账号不存在");
  save(list.filter((s) => s.id !== id));
}

/** 员工自己设置的 4 位确认密码（确认充值时用） */
export function setStaffPin(id: number, pin: string) {
  if (!/^\d{4}$/.test(pin)) throw new Error("确认密码必须是 4 位数字");
  update(id, (s) => ({ ...s, pinHash: hashPassword(pin) }));
}

export function verifyStaffPin(id: number, pin: string): boolean | null {
  const s = getStaff(id);
  if (!s?.pinHash) return null;
  return verifyPassword(pin, s.pinHash);
}

/** 登录：成功返回账号（并记下登录时间） */
export function staffLogin(username: string, password: string): StaffAccount | null {
  const s = load().find((x) => x.username === username.trim().toLowerCase());
  // 账号不存在时也算一次哈希，避免靠响应时间猜登录名
  const ok = verifyPassword(password, s?.pwHash ?? "scrypt$00$00");
  if (!s || !ok || !s.active) return null;
  update(s.id, (x) => ({ ...x, lastLoginAt: now() }));
  return getStaff(s.id);
}

/* ---------------- 客户权限 ---------------- */

export function accessOf(s: Pick<StaffAccount, "access"> | null | undefined): StaffAccess {
  return s?.access ?? { mode: "all", customers: {} };
}

/**
 * 公司自用账户（成本价、不扣余额）：员工一律看不到、不能操作，不管是“全部客户”模式还是单独授权。
 * 这个文件不打开数据库（proxy 也要用），不知道哪个客户是公司自用账户：由打开数据库的一方（auth.ts、quoteStream.ts）注册判断方法。
 * 还没注册时宁可当成看不到（员工对所有客户都是 null）；proxy 只做粗检查（传 skipInternal），页面和操作里会再完整检查一遍。
 * 放在 globalThis 上：同一个进程里即使这个文件被打包成几份，注册一次处处有效。
 */
type InternalCheck = (customerId: number) => boolean;
const reg = globalThis as unknown as { __atrInternalCustomerCheck?: InternalCheck };

export function setInternalCustomerCheck(fn: InternalCheck) {
  reg.__atrInternalCustomerCheck = fn;
}

/** 员工对某个客户的权限：null = 看不到（公司自用账户永远是 null） */
export function customerLevel(s: Pick<StaffAccount, "access"> | null | undefined, customerId: number, opts: { skipInternal?: boolean } = {}): AccessLevel | null {
  if (!s) return null;
  if (!opts.skipInternal) {
    const isInternal = reg.__atrInternalCustomerCheck;
    if (!isInternal || isInternal(customerId)) return null;
  }
  const a = accessOf(s);
  const v = a.customers[String(customerId)];
  if (a.mode === "all") return v === "none" ? null : v === "view" ? "view" : "edit";
  return v === "view" || v === "edit" ? v : null;
}

export function setStaffAccess(id: number, access: StaffAccess) {
  const mode = access.mode === "all" ? "all" : "list";
  // 只存跟默认不一样的：全部客户模式下默认能操作（只记 view / none），指定客户模式下默认看不到（只记 view / edit）
  const customers: Record<string, AccessSetting> = {};
  for (const [k, v] of Object.entries(access.customers ?? {})) {
    if (!(Number(k) > 0)) continue;
    if (mode === "all" ? v === "view" || v === "none" : v === "view" || v === "edit") customers[String(Number(k))] = v;
  }
  update(id, (s) => ({ ...s, access: { mode, customers } }));
}

/** 员工新建客户后：自动加进他的名单（能操作） */
export function grantCustomer(id: number, customerId: number, level: AccessLevel = "edit") {
  const s = getStaff(id);
  if (!s) return;
  const a = accessOf(s);
  if (a.mode === "all") {
    const rest = { ...a.customers };
    delete rest[String(customerId)];
    return setStaffAccess(id, { mode: "all", customers: rest });
  }
  setStaffAccess(id, { mode: "list", customers: { ...a.customers, [String(customerId)]: level } });
}
