/**
 * 销售佣金：客户可以归属一个销售，这个客户的订单按利润 × 比例给销售算佣金。
 *
 * - 归属按“生效日期”记历史：从某天起归谁、比例多少。第一次分配默认“全部订单”（包括以前的单）。
 *   换销售 / 改比例时选从哪天起生效，之前的单还算原来的人和比例。
 * - 比例按客户定（客户给的价高，提成可以高）；客户没单独设时用销售的默认比例（可以不设）。
 *   两个都没有 = 未设比例，这个客户的单佣金算 0，页面上提示去设置。
 * - 佣金 = 单票利润（和报表里的利润一样：客户价 − 成本 + 补差，取消单算手续费差额）× 比例。
 *   亏损单是负数，冲减佣金。异常单（还没结果）不算。内部测试 / 模拟单不算。
 * - 结算：把截至某天还没结的佣金一次结清，按单记下结了多少。之后补差导致利润变了，
 *   差额会出现在下一次结算里（应结 = 现在算出来的 − 已经结过的），不会重复也不会漏。
 */
import { db, getCustomer, getShipment, listCustomers, listShipments, shipmentProfit, type Shipment } from "./db";
import { localDate } from "./reports";

export interface SalesRep {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  /** 默认佣金比例（利润的百分比）；null = 不设默认，全部按客户设置 */
  rate: number | null;
  note: string | null;
  active: boolean;
  createdAt: string;
  /** 绑定的员工账号（员工在自己的看板里看这个销售的提成） */
  staffId: number | null;
}

export interface Assignment {
  id: number;
  customerId: number;
  /** null = 从这天起没有销售 */
  salesId: number | null;
  /** null = 用销售的默认比例 */
  rate: number | null;
  /** "" = 全部订单（不限日期）；否则 yyyy-mm-dd 起 */
  startDate: string;
  createdAt: string;
  createdBy: string | null;
}

export interface CommissionLine {
  shipment: Shipment;
  date: string;
  salesId: number;
  /** 这单用的比例；null = 客户和销售都没设比例 */
  rate: number | null;
  /** 结算后改归别人，冲回的一行 */
  reversed: boolean;
  profit: number;
  commission: number;
  paid: number;
  due: number;
}

export interface Payout {
  id: number;
  salesId: number;
  periodTo: string;
  amount: number;
  orders: number;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
}

function ensureTables() {
  const conn = db();
  conn.exec(`
    CREATE TABLE IF NOT EXISTS sales_reps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      rate REAL,
      note TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS customer_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      sales_id INTEGER REFERENCES sales_reps(id),
      rate REAL,
      start_date TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_customer_sales ON customer_sales(customer_id, start_date);
    CREATE TABLE IF NOT EXISTS commission_payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sales_id INTEGER NOT NULL REFERENCES sales_reps(id),
      period_to TEXT NOT NULL,
      amount REAL NOT NULL,
      orders INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT
    );
    CREATE TABLE IF NOT EXISTS commission_paid (
      payout_id INTEGER NOT NULL REFERENCES commission_payouts(id),
      sales_id INTEGER NOT NULL,
      shipment_id INTEGER NOT NULL,
      amount REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_commission_paid ON commission_paid(shipment_id);
  `);
  // 第一版销售表的默认比例是必填（NOT NULL）：改成可以不填
  const col = (conn.prepare("PRAGMA table_info(sales_reps)").all() as { name: string; notnull: number }[]).find((c) => c.name === "rate");
  if (col?.notnull) {
    // 重建表时先关掉外键检查（客户归属表引用了销售表），重建完再打开
    const fk = conn.pragma("foreign_keys", { simple: true });
    conn.pragma("foreign_keys = OFF");
    conn.transaction(() => {
      conn.exec(`CREATE TABLE sales_reps_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT, email TEXT, rate REAL, note TEXT,
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
        INSERT INTO sales_reps_new SELECT id, name, phone, email, rate, note, active, created_at FROM sales_reps;
        DROP TABLE sales_reps;
        ALTER TABLE sales_reps_new RENAME TO sales_reps;`);
    })();
    if (fk) conn.pragma("foreign_keys = ON");
  }
  // 员工账号绑定销售（算提成）：一个员工对应一个销售
  if (!(conn.prepare("PRAGMA table_info(sales_reps)").all() as { name: string }[]).some((c) => c.name === "staff_id")) {
    conn.exec("ALTER TABLE sales_reps ADD COLUMN staff_id INTEGER");
  }
  return conn;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** 订单的本地日期（created_at 存的是 UTC） */
export function shipmentLocalDate(s: Shipment): string {
  const d = new Date(s.createdAt.replace(" ", "T") + "Z");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type RepRow = { id: number; name: string; phone: string | null; email: string | null; rate: number | null; note: string | null; active: number; created_at: string; staff_id: number | null };
const toRep = (r: RepRow): SalesRep => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, rate: r.rate, note: r.note, active: !!r.active, createdAt: r.created_at, staffId: r.staff_id ?? null });

/** 员工账号绑定的销售（没绑定 = null） */
export function salesOfStaff(staffId: number): SalesRep | null {
  const r = ensureTables().prepare("SELECT * FROM sales_reps WHERE staff_id = ?").get(staffId) as RepRow | undefined;
  return r ? toRep(r) : null;
}

/**
 * 员工账号绑定销售：一个员工对应一个销售，一个销售也只对应一个员工。绑定后员工在看板里看这个销售的提成。
 * 提成是按客户单独绑定的（客户详情 → 销售：选销售和这个客户的比例）；没绑定销售的客户利润全部归公司。
 * salesId = null 解除绑定；"new" = 用员工的名字新建一个销售再绑定。
 */
export function bindStaffSales(staffId: number, staffName: string, salesId: number | "new" | null): SalesRep | null {
  const conn = ensureTables();
  let target: number | null = null;
  if (salesId === "new") {
    const exists = conn.prepare("SELECT id FROM sales_reps WHERE name = ?").get(staffName.trim()) as { id: number } | undefined;
    target = exists?.id ?? saveSales({ name: staffName, rate: null });
  } else if (salesId !== null) {
    if (!getSales(salesId)) throw new Error("销售不存在");
    target = salesId;
  }
  if (target !== null) {
    const other = conn.prepare("SELECT staff_id FROM sales_reps WHERE id = ?").get(target) as { staff_id: number | null } | undefined;
    if (other?.staff_id && other.staff_id !== staffId) throw new Error("这个销售已经绑定了别的员工账号，请先在那个员工那里解除绑定");
  }
  conn.transaction(() => {
    conn.prepare("UPDATE sales_reps SET staff_id = NULL WHERE staff_id = ?").run(staffId);
    if (target !== null) conn.prepare("UPDATE sales_reps SET staff_id = ? WHERE id = ?").run(staffId, target);
  })();
  return target === null ? null : getSales(target);
}


export function listSales(): SalesRep[] {
  return (ensureTables().prepare("SELECT * FROM sales_reps ORDER BY active DESC, name").all() as RepRow[]).map(toRep);
}

export function getSales(id: number): SalesRep | null {
  const r = ensureTables().prepare("SELECT * FROM sales_reps WHERE id = ?").get(id) as RepRow | undefined;
  return r ? toRep(r) : null;
}

export function parseRate(v: unknown): number {
  const n = Number(v);
  if (String(v ?? "").trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) throw new Error("佣金比例请填 0–100 之间的数字（利润的百分比）");
  return round2(n);
}

export function saveSales(input: { id?: number; name: string; phone?: string | null; email?: string | null; rate?: number | string | null; note?: string | null; active?: boolean }): number {
  const conn = ensureTables();
  const name = input.name.trim();
  if (!name) throw new Error("请填写销售姓名");
  const dupe = conn.prepare("SELECT id FROM sales_reps WHERE name = ? AND id != ?").get(name, input.id ?? 0);
  if (dupe) throw new Error("已经有同名的销售了");
  const rate = input.rate === null || input.rate === undefined || String(input.rate).trim() === "" ? null : parseRate(input.rate);
  const vals = [name, input.phone || null, input.email || null, rate, input.note || null, input.active === false ? 0 : 1];
  if (input.id) {
    if (!conn.prepare("UPDATE sales_reps SET name = ?, phone = ?, email = ?, rate = ?, note = ?, active = ? WHERE id = ?").run(...vals, input.id).changes) throw new Error("销售不存在");
    return input.id;
  }
  return Number(conn.prepare("INSERT INTO sales_reps (name, phone, email, rate, note, active) VALUES (?,?,?,?,?,?)").run(...vals).lastInsertRowid);
}

type AsgRow = { id: number; customer_id: number; sales_id: number | null; rate: number | null; start_date: string; created_at: string; created_by: string | null };
const toAsg = (r: AsgRow): Assignment => ({ id: r.id, customerId: r.customer_id, salesId: r.sales_id, rate: r.rate, startDate: r.start_date, createdAt: r.created_at, createdBy: r.created_by });

/** 一个客户的归属历史（按生效日期从早到晚；同一天后加的在后面） */
export function assignmentsOf(customerId: number): Assignment[] {
  return (ensureTables().prepare("SELECT * FROM customer_sales WHERE customer_id = ? ORDER BY start_date, id").all(customerId) as AsgRow[]).map(toAsg);
}

function allAssignments(): Map<number, Assignment[]> {
  const m = new Map<number, Assignment[]>();
  for (const r of ensureTables().prepare("SELECT * FROM customer_sales ORDER BY start_date, id").all() as AsgRow[]) {
    const list = m.get(r.customer_id) ?? [];
    list.push(toAsg(r));
    m.set(r.customer_id, list);
  }
  return m;
}

/** 某天生效的归属（没有 = undefined） */
function pick(list: Assignment[] | undefined, date: string): Assignment | undefined {
  let hit: Assignment | undefined;
  for (const a of list ?? []) if (a.startDate <= date) hit = a;
  return hit;
}

/** 客户现在归属的销售（今天生效的） */
export function currentAssignment(customerId: number, today = localDate()) {
  return pick(assignmentsOf(customerId), today);
}

/**
 * 分配 / 更换销售。startDate "" = 全部订单（包括以前的）。
 * 同一个生效日期再改一次就覆盖那一条（避免同一天堆好几条）。
 */
export function assignCustomer(customerId: number, input: { salesId: number | null; rate: number | null; startDate: string; by?: string }) {
  const conn = ensureTables();
  if (!getCustomer(customerId)) throw new Error("客户不存在");
  const rep = input.salesId === null ? null : getSales(input.salesId);
  if (input.salesId !== null && !rep) throw new Error("销售不存在");
  if (rep && input.rate === null && rep.rate === null) throw new Error("请填写这个客户的佣金比例");
  const start = input.startDate.trim();
  if (start && !isDate(start)) throw new Error("生效日期格式不对");
  const rate = input.rate === null ? null : parseRate(input.rate);
  const same = conn.prepare("SELECT id FROM customer_sales WHERE customer_id = ? AND start_date = ?").get(customerId, start) as { id: number } | undefined;
  if (same) conn.prepare("UPDATE customer_sales SET sales_id = ?, rate = ?, created_at = datetime('now'), created_by = ? WHERE id = ?").run(input.salesId, rate, input.by ?? null, same.id);
  else conn.prepare("INSERT INTO customer_sales (customer_id, sales_id, rate, start_date, created_by) VALUES (?,?,?,?,?)").run(customerId, input.salesId, rate, start, input.by ?? null);
}

export function deleteAssignment(customerId: number, id: number) {
  ensureTables().prepare("DELETE FROM customer_sales WHERE id = ? AND customer_id = ?").run(id, customerId);
}

/** 每单已经结算过的佣金（按销售分开） */
function paidMap(): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of ensureTables().prepare("SELECT sales_id, shipment_id, SUM(amount) AS a FROM commission_paid GROUP BY sales_id, shipment_id").all() as { sales_id: number; shipment_id: number; a: number }[]) {
    m.set(`${r.sales_id}:${r.shipment_id}`, r.a);
  }
  return m;
}

/**
 * 佣金明细：每张归属了销售的订单一行。
 * 已经结算过、但后来归属换了人的单，原来的人那里也保留一行（应结 = 0 − 已结，冲回去）。
 */
export function commissionLines(f: { salesId?: number; customerId?: number; from?: string; to?: string } = {}): CommissionLine[] {
  const asg = allAssignments();
  const reps = new Map(listSales().map((r) => [r.id, r]));
  const paid = paidMap();
  const customerIds = f.customerId ? [f.customerId] : [...asg.keys()];
  const lines: CommissionLine[] = [];
  const seen = new Set<string>();
  for (const cid of customerIds) {
    const list = asg.get(cid);
    for (const s of listShipments({ customerId: cid, from: f.from, to: f.to })) {
      if (s.isTest) continue;
      const date = shipmentLocalDate(s);
      const a = pick(list, date);
      if (!a?.salesId) continue;
      const rep = reps.get(a.salesId);
      if (!rep) continue;
      const rate = a.rate ?? rep.rate;
      const profit = round2(shipmentProfit(s) ?? 0);
      const commission = rate === null ? 0 : round2((profit * rate) / 100);
      const key = `${a.salesId}:${s.id}`;
      seen.add(key);
      const p = round2(paid.get(key) ?? 0);
      if (!f.salesId || f.salesId === a.salesId) lines.push({ shipment: s, date, salesId: a.salesId, rate, reversed: false, profit, commission, paid: p, due: round2(commission - p) });
    }
  }
  // 结算过但现在不归这个人了：冲回
  for (const [key, p] of paid) {
    if (seen.has(key) || !p) continue;
    const [sid, shipId] = key.split(":").map(Number);
    if (f.salesId && f.salesId !== sid) continue;
    const s = getShipment(shipId);
    if (!s || (f.customerId && s.customerId !== f.customerId)) continue;
    const date = shipmentLocalDate(s);
    if ((f.from && date < f.from) || (f.to && date > f.to)) continue;
    lines.push({ shipment: s, date, salesId: sid, rate: null, reversed: true, profit: round2(shipmentProfit(s) ?? 0), commission: 0, paid: round2(p), due: round2(-p) });
  }
  return lines.sort((a, b) => (a.date === b.date ? b.shipment.id - a.shipment.id : a.date < b.date ? 1 : -1));
}

export interface SalesSummary {
  rep: SalesRep;
  customers: number;
  orders: number;
  profit: number;
  commission: number;
  /** 还没结算的（不限日期） */
  due: number;
  /** 本期没有比例（客户、销售都没设）的订单数 */
  noRate: number;
}

/** 销售列表页：每个销售的客户数、本期订单 / 利润 / 佣金、未结算金额 */
export function salesSummaries(from?: string, to?: string): SalesSummary[] {
  const all = commissionLines();
  const inRange = (l: CommissionLine) => (!from || l.date >= from) && (!to || l.date <= to);
  const custCount = new Map<number, number>();
  for (const c of listCustomers()) {
    const a = currentAssignment(c.id);
    if (a?.salesId) custCount.set(a.salesId, (custCount.get(a.salesId) ?? 0) + 1);
  }
  return listSales().map((rep) => {
    const mine = all.filter((l) => l.salesId === rep.id);
    const period = mine.filter(inRange);
    return {
      rep,
      customers: custCount.get(rep.id) ?? 0,
      orders: period.filter((l) => !l.reversed).length,
      noRate: period.filter((l) => !l.reversed && l.rate === null).length,
      profit: round2(period.reduce((a, l) => a + l.profit, 0)),
      commission: round2(period.reduce((a, l) => a + l.commission, 0)),
      due: round2(mine.reduce((a, l) => a + l.due, 0)),
    };
  });
}

/** 客户现在归属的销售名字（客户列表用） */
export function salesNameByCustomer(): Map<number, string> {
  const reps = new Map(listSales().map((r) => [r.id, r.name]));
  const m = new Map<number, string>();
  for (const c of listCustomers()) {
    const a = currentAssignment(c.id);
    if (a?.salesId && reps.has(a.salesId)) m.set(c.id, reps.get(a.salesId)!);
  }
  return m;
}

/**
 * 员工新开的客户：默认归开户的员工（他绑定的销售；还没绑定就用他的名字新建一个销售并绑定），
 * 这个客户的提成比例 = rate（例如 30 = 利润的 30% 给员工，70% 归公司）。比例记在这个客户上，之后可以单独改。
 * 客户已经有销售的不动。
 */
export function assignNewCustomerToStaff(customerId: number, staff: { id: number; name: string }, rate: number) {
  if (currentAssignment(customerId)) return;
  const rep = salesOfStaff(staff.id) ?? bindStaffSales(staff.id, staff.name, "new");
  if (!rep) return;
  ensureTables().prepare("INSERT INTO customer_sales (customer_id, sales_id, rate, start_date, created_by) VALUES (?,?,?,'',?)").run(customerId, rep.id, parseRate(rate), staff.name);
}

/** 结算：把截至 upTo（含）还没结的佣金一次结清；没有可结的返回 null */
export function settle(salesId: number, upTo: string, note: string | null, by: string): Payout | null {
  if (!isDate(upTo)) throw new Error("请选择结算截止日期");
  if (!getSales(salesId)) throw new Error("销售不存在");
  const conn = ensureTables();
  const lines = commissionLines({ salesId, to: upTo }).filter((l) => l.due !== 0);
  if (!lines.length) return null;
  const amount = round2(lines.reduce((a, l) => a + l.due, 0));
  const id = conn.transaction(() => {
    const pid = Number(conn.prepare("INSERT INTO commission_payouts (sales_id, period_to, amount, orders, note, created_by) VALUES (?,?,?,?,?,?)").run(salesId, upTo, amount, lines.length, note, by).lastInsertRowid);
    const ins = conn.prepare("INSERT INTO commission_paid (payout_id, sales_id, shipment_id, amount) VALUES (?,?,?,?)");
    for (const l of lines) ins.run(pid, salesId, l.shipment.id, l.due);
    return pid;
  })();
  return listPayouts(salesId).find((p) => p.id === id)!;
}

export function listPayouts(salesId: number): Payout[] {
  const rows = ensureTables().prepare("SELECT * FROM commission_payouts WHERE sales_id = ? ORDER BY id DESC").all(salesId) as {
    id: number; sales_id: number; period_to: string; amount: number; orders: number; note: string | null; created_at: string; created_by: string | null;
  }[];
  return rows.map((r) => ({ id: r.id, salesId: r.sales_id, periodTo: r.period_to, amount: r.amount, orders: r.orders, note: r.note, createdAt: r.created_at, createdBy: r.created_by }));
}
