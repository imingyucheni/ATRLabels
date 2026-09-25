import { fmtTime } from "@/lib/time";
import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { db } from "@/lib/db";
import { listOwnShipments } from "@/lib/portal";
import { money, usd } from "@/lib/pricing";
import { buildReport, localDate } from "@/lib/reports";
import { listDraftRows } from "@/lib/batch";
import { ChannelBars, DailyBars } from "@/components/charts";
import StatusBadge from "@/components/StatusBadge";
import { getT } from "@/lib/prefs";
import type { T } from "@/lib/i18n";

/** n 天前的日期（yyyy-mm-dd） */
function dayOffset(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDate(d);
}

/** 某天取消（含申请取消中）的单数：按取消发生的日期算 */
function cancelledOn(customerId: number, day: string) {
  return (
    db()
      .prepare(
        `SELECT COUNT(*) AS n FROM shipments WHERE customer_id = ? AND status IN ('cancelled','cancel_requested')
         AND date(updated_at, 'localtime') = ?`,
      )
      .get(customerId, day) as { n: number }
  ).n;
}

/** 和昨天比 */
function Trend({ now, prev, unit = "", upBad = false, t }: { now: number; prev: number; unit?: string; upBad?: boolean; t: T }) {
  if (!now && !prev) return <div className="small muted">{t("昨天也没有")}</div>;
  const diff = Math.round((now - prev) * 100) / 100;
  if (!diff) return <div className="small muted">{t("和昨天一样")}</div>;
  return (
    <div className={`small ${diff > 0 ? (upBad ? "trend-bad" : "trend-up") : "trend-down"}`}>
      {diff > 0 ? "▲" : "▼"} {t(diff > 0 ? "比昨天多 {v}" : "比昨天少 {v}", { v: unit + (unit ? Math.abs(diff).toFixed(2) : Math.abs(diff)) })}
    </div>
  );
}

export default async function PortalHome() {
  const me = await requireCustomer();
  const tr = await getT();
  const today = dayOffset(0);
  const t = buildReport(today, today, me.id).totals;
  const y = buildReport(dayOffset(1), dayOffset(1), me.id).totals;
  const r30 = buildReport(dayOffset(29), today, me.id);
  const r7 = buildReport(dayOffset(6), today, me.id).totals;
  const month = buildReport(today.slice(0, 8) + "01", today, me.id).totals;
  const cancelledToday = cancelledOn(me.id, today);
  const cancelledYesterday = cancelledOn(me.id, dayOffset(1));
  const drafts = listDraftRows(me.id).length;
  const open = listOwnShipments(me.id, { limit: 300 });
  const count = (st: string) => open.filter((s) => s.status === st).length;
  const attention = open.filter((s) => ["pending", "exception", "cancel_requested"].includes(s.status)).slice(0, 8);
  const recent = listOwnShipments(me.id, { limit: 8 });

  const available = me.balance + me.creditLimit;
  const perDay = r7.revenue / 7;
  const runway = perDay > 0 ? Math.floor(Math.max(available, 0) / perDay) : null;
  const busiest = r30.daily.reduce((a, d) => (d.orders > a.orders ? d : a), r30.daily[0]);
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Los_Angeles" }).format(new Date()));
  const hello = tr(hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好");

  const todos = [
    { href: "/portal/drafts", label: tr("待出单"), n: drafts, tone: "on" },
    { href: "/portal/shipments?status=pending", label: tr("处理中"), n: count("pending"), tone: "on" },
    { href: "/portal/shipments?status=exception", label: tr("异常"), n: count("exception"), tone: "bad" },
    { href: "/portal/shipments?status=cancel_requested", label: tr("取消中"), n: count("cancel_requested"), tone: "on" },
  ];

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{tr("{hello}，{name}", { hello, name: me.name })}</h1>
          <div className="muted small">{tr("今天是 {date}（美西时间）", { date: today })}</div>
        </div>
        <div className="row">
          <Link className="btn primary" href="/portal/ship">＋ {tr("单个下单")}</Link>
          <Link className="btn" href="/portal/batch">{tr("批量导入")}</Link>
          <Link className="btn" href="/portal/topup">{tr("充值")}</Link>
        </div>
      </div>

      {available <= 0 ? (
        <div className="alert err">{tr("账户余额不足（{balance}），需要先", { balance: usd(me.balance) })} <Link href="/portal/topup">{tr("充值")}</Link> {tr("才能继续下单。")}</div>
      ) : runway !== null && runway <= 3 ? (
        <div className="alert warn">{tr("按最近 7 天的用量，余额大约只够 {n} 天，建议提前", { n: runway || tr("不到 1") })} <Link href="/portal/topup">{tr("充值")}</Link>{tr("，避免出单中断。")}</div>
      ) : null}

      <div className="kpis">
        <div className="kpi kpi-hero">
          <div className="kpi-label">{tr("今日出单")}</div>
          <div className="kpi-value">{t.orders}</div>
          <Trend now={t.orders} prev={y.orders} t={tr} />
        </div>
        <div className="kpi">
          <div className="kpi-label">{tr("今日退单")}</div>
          <div className={`kpi-value${cancelledToday ? " neg" : ""}`}>{cancelledToday}</div>
          <Trend now={cancelledToday} prev={cancelledYesterday} upBad t={tr} />
        </div>
        <div className="kpi">
          <div className="kpi-label">{tr("今日运费")}</div>
          <div className="kpi-value">{usd(t.revenue)}</div>
          <Trend now={t.revenue} prev={y.revenue} unit="$" t={tr} />
        </div>
        <div className="kpi">
          <div className="kpi-label">{tr("账户余额")}</div>
          <div className={`kpi-value${me.balance < 0 ? " neg" : ""}`}>{usd(me.balance)}</div>
          <div className="small muted">
            {me.creditLimit > 0 && <>{tr("可用 {amount}（含信用额度）", { amount: usd(available) })} · </>}
            {runway !== null ? tr("约够用 {n} 天", { n: runway }) : tr("最近 7 天没有出单")}
          </div>
        </div>
      </div>

      <div className="todo-row">
        {todos.map((x) => (
          <Link key={x.label} href={x.href} className={`todo${x.n ? " " + x.tone : ""}`}>
            <b>{x.n}</b>
            <span>{x.label}</span>
          </Link>
        ))}
        <div className="todo static"><b>{month.orders}</b><span>{tr("本月出单")}</span></div>
        <div className="todo static"><b>{usd(month.revenue)}</b><span>{tr("本月运费")}</span></div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>{tr("近 30 天每日出单")}</h2>
          <p className="small muted" style={{ marginTop: -6 }}>
            {tr("共 {n} 单，日均 {avg} 单", { n: r30.totals.orders, avg: (r30.totals.orders / 30).toFixed(1) })}
            {busiest && busiest.orders > 0 && tr("，最多的一天 {date}（{n} 单）", { date: busiest.date.slice(5), n: busiest.orders })}
          </p>
          <DailyBars data={r30.daily.map((d) => ({ date: d.date, orders: d.orders, revenue: d.revenue }))} revenueLabel={tr("运费")} />
        </div>
        <div className="card">
          <h2>{tr("近 30 天渠道分布")}</h2>
          <p className="small muted" style={{ marginTop: -6 }}>
            {r30.totals.orders ? tr("平均每单 {amount}", { amount: usd(r30.totals.revenue / r30.totals.orders) }) : tr("还没有出单")}
          </p>
          {r30.channels.length ? (
            <ChannelBars data={r30.channels.map((c) => ({ name: c.name, orders: c.orders, share: c.share, revenue: c.revenue }))} revenueLabel={tr("运费")} />
          ) : (
            <div className="muted small">{tr("出单后这里会显示各渠道的单量")}</div>
          )}
        </div>
      </div>

      {attention.length > 0 && (
        <div className="card table-wrap">
          <h2>{tr("需要注意")}</h2>
          <table className="list">
            <tbody>
              {attention.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/portal/shipments/${s.id}`}>{s.customerRef || s.customNo}</Link></td>
                  <td>{s.recipient.nameFirst} {s.recipient.nameLast}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td className="small muted">{s.problem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card table-wrap">
        <h2>{tr("最近面单")}</h2>
        <table className="list">
          <thead><tr><th>{tr("时间")}</th><th>{tr("单号")}</th><th>{tr("收件人")}</th><th>{tr("渠道")}</th><th>{tr("运单号")}</th><th>{tr("状态")}</th><th className="num">{tr("运费")}</th><th>{tr("面单")}</th></tr></thead>
          <tbody>
            {recent.map((s) => (
              <tr key={s.id}>
                <td className="small muted">{fmtTime(s.createdAt)}</td>
                <td><Link href={`/portal/shipments/${s.id}`}>{s.customerRef || s.customNo}</Link></td>
                <td>{s.recipient.nameFirst} {s.recipient.nameLast}<div className="small muted">{s.recipient.city}, {s.recipient.province ?? ""} {s.recipient.zipCode}</div></td>
                <td>{s.channelName}</td>
                <td>{s.trackingNo ?? "-"}</td>
                <td><StatusBadge status={s.status} /></td>
                <td className="num">{money(s.price, s.currency)}</td>
                <td>{s.hasLabel ? <a href={`/api/labels/${s.id}`} target="_blank">{tr("打印")}</a> : "-"}</td>
              </tr>
            ))}
            {!recent.length && <tr><td colSpan={8} className="muted">{tr("还没有面单，点“下单”开始")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
