import Link from "next/link";
import { listCustomers } from "@/lib/db";
import { LEDGER_TYPE_LABEL, listLedger } from "@/lib/ledger";
import { money } from "@/lib/pricing";

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const customers = listCustomers();
  const ledger = listLedger({ from: sp.from, to: sp.to, limit: 300 });
  const prepaid = customers.reduce((a, c) => a + Math.max(0, c.balance), 0);
  const owed = customers.reduce((a, c) => a + Math.min(0, c.balance), 0);
  const byType = ledger.reduce<Record<string, number>>((m, l) => ((m[l.type] = (m[l.type] ?? 0) + l.amount), m), {});
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <h1>财务</h1>
      <div className="stats">
        <div className="stat"><div className="muted">客户预存余额合计</div><div className="v">{money(prepaid)}</div></div>
        <div className="stat"><div className="muted">客户欠款合计</div><div className={`v ${owed < 0 ? "profit-neg" : ""}`}>{money(-owed)}</div></div>
        <div className="stat"><div className="muted">客户数</div><div className="v">{customers.length}</div></div>
      </div>

      <div className="card table-wrap">
        <h2>客户余额</h2>
        <table>
          <thead><tr><th>客户</th><th className="num">余额</th><th className="num">信用额度</th><th className="num">可用</th><th></th></tr></thead>
          <tbody>
            {[...customers].sort((a, b) => a.balance - b.balance).map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className={`num ${c.balance < 0 ? "profit-neg" : ""}`}>{money(c.balance)}</td>
                <td className="num">{money(c.creditLimit)}</td>
                <td className={`num ${c.balance + c.creditLimit <= 0 ? "profit-neg" : ""}`}>{money(c.balance + c.creditLimit)}</td>
                <td><Link href={`/customers/${c.id}`}>充值 / 流水</Link> · <Link href={`/customers/${c.id}/statement`}>对账单</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="card row" method="get">
        <label className="f">开始日期<input type="date" name="from" defaultValue={sp.from} /></label>
        <label className="f">结束日期<input type="date" name="to" defaultValue={sp.to} /></label>
        <button className="primary">筛选流水</button>
        <a className="btn" href={`/api/ledger?${qs}`}>导出流水 CSV</a>
      </form>
      <div className="stats">
        {Object.entries(byType).map(([t, v]) => (
          <div className="stat" key={t}><div className="muted">{LEDGER_TYPE_LABEL[t as keyof typeof LEDGER_TYPE_LABEL]}</div><div className="v">{money(v)}</div></div>
        ))}
      </div>
      <div className="card table-wrap">
        <h2>全部流水（最近 300 条）</h2>
        <table>
          <thead><tr><th>时间</th><th>客户</th><th>类型</th><th>单号</th><th>说明</th><th className="num">金额</th></tr></thead>
          <tbody>
            {ledger.map((l) => (
              <tr key={l.id}>
                <td className="small muted">{l.createdAt}</td>
                <td><Link href={`/customers/${l.customerId}`}>{l.customerName}</Link></td>
                <td>{LEDGER_TYPE_LABEL[l.type]}</td>
                <td>{l.shipmentId ? <Link href={`/shipments/${l.shipmentId}`}>{l.customNo}</Link> : "-"}</td>
                <td className="small">{l.note}</td>
                <td className={`num ${l.amount >= 0 ? "profit-pos" : ""}`}>{money(l.amount)}</td>
              </tr>
            ))}
            {!ledger.length && <tr><td colSpan={6} className="muted">没有流水</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
