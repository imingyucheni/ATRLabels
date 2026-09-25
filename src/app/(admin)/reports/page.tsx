import Link from "next/link";
import { getCustomer, listCustomers } from "@/lib/db";
import { money } from "@/lib/pricing";
import { buildReport, localDate, presetRanges, type Totals } from "@/lib/reports";
import { ChannelBars, DailyBars, RevenueLines } from "@/components/charts";

type SP = { from?: string; to?: string; customerId?: string; range?: string };

const pct = (a: number, b: number) => (b ? a / b : 0);

function Delta({ now, prev, money: isMoney }: { now: number; prev: number; money?: boolean }) {
  if (!prev && !now) return <span className="delta">—</span>;
  if (!prev) return <span className="delta up">新增</span>;
  const d = (now - prev) / Math.abs(prev);
  const cls = d > 0.0005 ? "up" : d < -0.0005 ? "down" : "";
  return (
    <span className={`delta ${cls}`} title={`上一周期 ${isMoney ? money(prev) : prev}`}>
      {d > 0 ? "▲" : d < 0 ? "▼" : ""} {Math.abs(d * 100).toFixed(1)}% <span className="muted">较上一周期</span>
    </span>
  );
}

function Kpi({ label, value, now, prev, isMoney, hint }: { label: string; value: string; now: number; prev?: number; isMoney?: boolean; hint?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {prev !== undefined ? <Delta now={now} prev={prev} money={isMoney} /> : <span className="delta muted">{hint}</span>}
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const presets = presetRanges();
  const preset = presets.find((p) => p.key === (sp.range ?? (sp.from ? "" : "30d")));
  const from = preset?.from ?? sp.from ?? presets[2].from;
  const to = preset?.to ?? sp.to ?? localDate();
  const customerId = Number(sp.customerId) || undefined;
  const customer = customerId ? getCustomer(customerId) : null;
  const r = buildReport(from, to, customerId);
  const t: Totals = r.totals;
  const margin = pct(t.profit, t.revenue);
  const prevMargin = pct(r.previous.profit, r.previous.revenue);
  const q = (extra: Record<string, string | undefined>) =>
    "?" + new URLSearchParams(Object.entries({ from, to, customerId: customerId ? String(customerId) : undefined, ...extra }).filter(([, v]) => v) as [string, string][]).toString();
  const exportQs = new URLSearchParams({ from, to, ...(customerId ? { customerId: String(customerId) } : {}) }).toString();
  const busiest = r.daily.reduce((a, d) => (d.orders > (a?.orders ?? -1) ? d : a), r.daily[0]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{customer ? `报表 · ${customer.name}` : "报表"}</h1>
          <p className="page-sub">
            {from} 至 {to} · 按下单日期统计{customer && <> · <Link href={q({ customerId: "" })}>查看全部客户</Link></>}
          </p>
        </div>
        <div className="row">
          <a className="btn" href={`/api/reports?type=daily&${exportQs}`}>导出每日</a>
          <a className="btn" href={`/api/reports?type=channel&${exportQs}`}>导出渠道</a>
          {!customer && <a className="btn" href={`/api/reports?type=customer&${exportQs}`}>导出客户</a>}
        </div>
      </div>

      <div className="filter-bar">
        <div className="seg">
          {presets.map((p) => (
            <Link key={p.key} href={`?range=${p.key}${customerId ? `&customerId=${customerId}` : ""}`} className={preset?.key === p.key ? "on" : ""}>{p.label}</Link>
          ))}
        </div>
        <form className="row" method="get">
          <input type="date" name="from" defaultValue={from} aria-label="开始日期" />
          <span className="muted">—</span>
          <input type="date" name="to" defaultValue={to} aria-label="结束日期" />
          <select name="customerId" defaultValue={customerId ?? ""} aria-label="客户">
            <option value="">全部客户</option>
            {listCustomers().map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button>应用</button>
        </form>
      </div>

      <div className="kpis">
        <Kpi label="订单" value={String(t.orders)} now={t.orders} prev={r.previous.orders} />
        <Kpi label="客户消费" value={money(t.revenue)} now={t.revenue} prev={r.previous.revenue} isMoney />
        <Kpi label="成本（ShipBest）" value={money(t.cost)} now={t.cost} prev={r.previous.cost} isMoney />
        <Kpi label="利润" value={money(t.profit)} now={t.profit} prev={r.previous.profit} isMoney />
        <Kpi label="利润率" value={`${(margin * 100).toFixed(1)}%`} now={margin} prev={prevMargin} />
        <Kpi label="充值到账" value={money(r.topups)} now={r.topups} hint={t.cancelled ? `取消 ${t.cancelled} 单` : "期间内确认的充值"} />
      </div>

      <div className="grid2">
        <section className="card">
          <div className="card-head"><h2>每日订单</h2>{busiest && busiest.orders > 0 && <span className="muted small">最高 {busiest.date} · {busiest.orders} 单</span>}</div>
          <DailyBars data={r.daily} />
        </section>
        <section className="card">
          <div className="card-head"><h2>每日客户消费与利润</h2><span className="muted small">美元</span></div>
          <RevenueLines data={r.daily} />
        </section>
      </div>

      <div className="grid2">
        <section className="card">
          <div className="card-head"><h2>渠道单量</h2><span className="muted small">共 {t.orders} 单</span></div>
          <ChannelBars data={r.channels} />
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table>
              <thead><tr><th>渠道</th><th className="num">订单</th><th className="num">客户消费</th><th className="num">成本</th><th className="num">利润</th><th className="num">利润率</th><th className="num">单均价</th></tr></thead>
              <tbody>
                {r.channels.map((c) => (
                  <tr key={c.code}>
                    <td>{c.name}</td>
                    <td className="num">{c.orders}</td>
                    <td className="num">{money(c.revenue)}</td>
                    <td className="num">{money(c.cost)}</td>
                    <td className="num">{money(c.profit)}</td>
                    <td className="num">{(pct(c.profit, c.revenue) * 100).toFixed(1)}%</td>
                    <td className="num">{money(c.orders ? c.revenue / c.orders : 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {!customer ? (
          <section className="card">
            <div className="card-head"><h2>客户排行</h2><span className="muted small">按客户消费排序，点名称看该客户每日明细</span></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>客户</th><th className="num">订单</th><th className="num">客户消费</th><th className="num">利润</th><th className="num">利润率</th><th className="num">余额</th></tr></thead>
                <tbody>
                  {r.customers.map((c) => (
                    <tr key={c.id}>
                      <td><Link href={q({ customerId: String(c.id), range: undefined })}>{c.name}</Link></td>
                      <td className="num">{c.orders}</td>
                      <td className="num">{money(c.revenue)}</td>
                      <td className="num">{money(c.profit)}</td>
                      <td className="num">{(pct(c.profit, c.revenue) * 100).toFixed(1)}%</td>
                      <td className={`num ${c.balance < 0 ? "neg" : ""}`}>{money(c.balance)}</td>
                    </tr>
                  ))}
                  {!r.customers.length && <tr><td colSpan={6} className="muted">这个期间没有订单</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="card">
            <div className="card-head"><h2>{customer.name}</h2><Link href={`/customers/${customer.id}`} className="small">客户管理 →</Link></div>
            <dl className="kv">
              <dt>当前余额</dt><dd className={customer.balance < 0 ? "neg" : ""}>{money(customer.balance)}</dd>
              <dt>信用额度</dt><dd>{money(customer.creditLimit)}</dd>
              <dt>期间订单</dt><dd>{t.orders} 单{t.cancelled ? `（另取消 ${t.cancelled} 单）` : ""}</dd>
              <dt>期间消费</dt><dd>{money(t.revenue)}</dd>
              <dt>期间利润</dt><dd>{money(t.profit)}（{(margin * 100).toFixed(1)}%）</dd>
              <dt>期间充值</dt><dd>{money(r.topups)}</dd>
            </dl>
            <div className="row" style={{ marginTop: 12 }}>
              <Link className="btn small" href={`/customers/${customer.id}/charges?from=${from}&to=${to}`}>按订单扣款明细</Link>
              <Link className="btn small" href={`/customers/${customer.id}/statement?from=${from}&to=${to}`}>对账单</Link>
            </div>
          </section>
        )}
      </div>

      <section className="card table-wrap">
        <div className="card-head"><h2>每日明细{customer ? ` · ${customer.name}` : ""}</h2></div>
        <table>
          <thead><tr><th>日期</th><th className="num">订单</th><th className="num">取消</th><th className="num">客户消费</th><th className="num">成本</th><th className="num">利润</th><th className="num">利润率</th></tr></thead>
          <tbody>
            {[...r.daily].reverse().map((d) => (
              <tr key={d.date} className={d.orders || d.cancelled ? "" : "quiet"}>
                <td>{d.date}</td>
                <td className="num">{d.orders}</td>
                <td className="num">{d.cancelled || ""}</td>
                <td className="num">{money(d.revenue)}</td>
                <td className="num">{money(d.cost)}</td>
                <td className="num">{money(d.profit)}</td>
                <td className="num">{d.revenue ? `${(pct(d.profit, d.revenue) * 100).toFixed(1)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td><b>合计</b></td><td className="num"><b>{t.orders}</b></td><td className="num">{t.cancelled || ""}</td><td className="num"><b>{money(t.revenue)}</b></td><td className="num"><b>{money(t.cost)}</b></td><td className="num"><b>{money(t.profit)}</b></td><td className="num"><b>{(margin * 100).toFixed(1)}%</b></td></tr>
          </tfoot>
        </table>
      </section>
    </>
  );
}
