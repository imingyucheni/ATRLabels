import Link from "next/link";
import { notFound } from "next/navigation";
import { money } from "@/lib/pricing";
import { buildStatement } from "@/lib/statement";

function monthRange(offset = 0) {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + offset + 1, 0);
  const f = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { from: f(first), to: f(last) };
}

export default async function StatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const id = Number((await params).id);
  const sp = await searchParams;
  const def = monthRange();
  const from = sp.from ?? def.from;
  const to = sp.to ?? def.to;
  const st = buildStatement(id, from || undefined, to || undefined);
  if (!st) notFound();
  const last = monthRange(-1);

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>对账单：{st.customer.name}</h1>
        <Link href="/customers">← 客户列表</Link>
      </div>
      <form className="card row" method="get">
        <label className="f">开始日期<input type="date" name="from" defaultValue={from} /></label>
        <label className="f">结束日期<input type="date" name="to" defaultValue={to} /></label>
        <button className="primary">查询</button>
        <Link className="btn" href={`?from=${def.from}&to=${def.to}`}>本月</Link>
        <Link className="btn" href={`?from=${last.from}&to=${last.to}`}>上月</Link>
        <a className="btn" href={`/api/statement?customerId=${id}&from=${from}&to=${to}`}>导出 CSV</a>
      </form>

      <div className="stats">
        <div className="stat"><div className="muted">面单费用</div><div className="v">{money(st.totals.labels)}</div></div>
        <div className="stat"><div className="muted">取消手续费</div><div className="v">{money(st.totals.cancels)}</div></div>
        <div className="stat"><div className="muted">账单补差</div><div className="v">{money(st.totals.adjustments)}</div></div>
        <div className="stat"><div className="muted">应收合计</div><div className="v">{money(st.totals.total)}</div></div>
      </div>

      <div className="card table-wrap">
        <table>
          <thead><tr><th>日期</th><th>类型</th><th>单号</th><th>运单号</th><th>说明</th><th className="num">金额</th></tr></thead>
          <tbody>
            {st.lines.map((l, i) => (
              <tr key={i}>
                <td className="small muted">{l.date}</td>
                <td><span className={`badge ${l.type === "补差" ? "pending" : l.type === "取消" ? "cancelled" : "labeled"}`}>{l.type}</span></td>
                <td>{l.shipmentId ? <Link href={`/shipments/${l.shipmentId}`}>{l.ref}</Link> : l.ref}</td>
                <td>{l.trackingNo}</td>
                <td className="small">{l.detail}</td>
                <td className="num">{money(l.amount)}</td>
              </tr>
            ))}
            {!st.lines.length && <tr><td colSpan={6} className="muted">这个期间没有记录</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="small muted">面单按创建日期统计；补差按导入日期统计（补差对应的面单可能是之前月份的）。金额为负表示退给客户。</p>
    </>
  );
}
