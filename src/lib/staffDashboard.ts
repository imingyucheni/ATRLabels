/**
 * 员工看板（“我的看板”）：员工自己负责的客户——授权给他的客户，以及归到他绑定的销售名下的客户——
 * 的消费、面单数、成本、利润（和报表同一口径），以及他自己的提成（按“销售佣金”的规则算）。
 * 公司自用账户（成本价）不算在内；测试单不计入统计（和概览、报表一样）。
 */
import type { AdminPrincipal } from "./adminSession";
import { customerFilter } from "./adminSession";
import { commissionLines, currentAssignment, listPayouts, listSales, salesOfStaff, type Payout, type SalesRep } from "./commission";
import { listCustomers, listShipments, shipmentCost, shipmentProfit, shipmentReceivable, type Shipment } from "./db";

export interface DashCustomer {
  id: number;
  name: string;
  orders: number;
  cancelled: number;
  revenue: number;
  cost: number;
  profit: number;
  balance: number;
  /** 期间内最后一次下单（本地日期时间字符串，没有 = null） */
  lastAt: string | null;
  /** 现在归属的销售（null = 还没分配） */
  salesName: string | null;
  /** 归在这个员工绑定的销售名下（算他的提成） */
  mine: boolean;
  /** 授权给这个员工了（能打开客户详情）；只是归他名下、没授权的只看统计 */
  canOpen: boolean;
}

export interface StaffDashboard {
  customers: DashCustomer[];
  totals: { customers: number; orders: number; cancelled: number; revenue: number; cost: number; profit: number };
  /** 期间内的测试单数（不计入统计） */
  tests: number;
  /** 期间内的订单（最新在前，最多 100 张） */
  recent: Shipment[];
  commission: null | {
    rep: SalesRep;
    /** 期间内 */
    orders: number;
    profit: number;
    commission: number;
    /** 期间内没有比例（客户、销售都没设）的订单数 */
    noRate: number;
    /** 还没结算的（不限日期） */
    due: number;
    /** 已经结算发放的合计 */
    paidTotal: number;
    payouts: Payout[];
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function staffDashboard(who: AdminPrincipal, from: string, to: string): StaffDashboard {
  const rep = who.role === "staff" ? salesOfStaff(who.id) : null;
  const canSee = customerFilter(who);
  const reps = new Map(listSales().map((r) => [r.id, r.name]));
  // 自己负责的客户：授权给他的，加上归到他销售名下的（他要看到自己提成的来源）
  const customers = listCustomers().filter((c) => {
    if (canSee(c.id)) return true;
    const a = rep ? currentAssignment(c.id) : undefined;
    return !!rep && a?.salesId === rep.id;
  });
  const ids = new Set(customers.map((c) => c.id));
  const all = listShipments({ from, to }).filter((s) => ids.has(s.customerId));
  const real = all.filter((s) => !s.isTest);

  const rows = new Map<number, DashCustomer>(
    customers.map((c) => {
      const a = currentAssignment(c.id);
      return [c.id, { id: c.id, name: c.name, orders: 0, cancelled: 0, revenue: 0, cost: 0, profit: 0, balance: c.balance, lastAt: null, salesName: a?.salesId ? reps.get(a.salesId) ?? null : null, mine: !!rep && a?.salesId === rep.id, canOpen: canSee(c.id) }];
    }),
  );
  const totals = { customers: customers.length, orders: 0, cancelled: 0, revenue: 0, cost: 0, profit: 0 };
  for (const s of real) {
    // 和报表一样：异常单（还没结果）不算；取消单算取消手续费
    if (s.status === "exception") continue;
    const row = rows.get(s.customerId)!;
    for (const t of [row, totals]) {
      if (s.status === "cancelled") t.cancelled++;
      else t.orders++;
      t.revenue += shipmentReceivable(s);
      t.cost += shipmentCost(s);
      t.profit += shipmentProfit(s) ?? 0;
    }
    if (!row.lastAt || s.createdAt > row.lastAt) row.lastAt = s.createdAt;
  }
  const list = [...rows.values()].map((r) => ({ ...r, revenue: r2(r.revenue), cost: r2(r.cost), profit: r2(r.profit) }));
  list.sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));

  let commission: StaffDashboard["commission"] = null;
  if (rep) {
    const lines = commissionLines({ salesId: rep.id });
    const period = lines.filter((l) => l.date >= from && l.date <= to);
    const payouts = listPayouts(rep.id);
    commission = {
      rep,
      orders: period.filter((l) => !l.reversed).length,
      profit: r2(period.reduce((a, l) => a + l.profit, 0)),
      commission: r2(period.reduce((a, l) => a + l.commission, 0)),
      noRate: period.filter((l) => !l.reversed && l.rate === null).length,
      due: r2(lines.reduce((a, l) => a + l.due, 0)),
      paidTotal: r2(payouts.reduce((a, p) => a + p.amount, 0)),
      payouts: payouts.slice(0, 10),
    };
  }

  return {
    customers: list,
    totals: { ...totals, revenue: r2(totals.revenue), cost: r2(totals.cost), profit: r2(totals.profit) },
    tests: all.filter((s) => s.isTest && s.status !== "cancelled").length,
    recent: real.slice(0, 100),
    commission,
  };
}
