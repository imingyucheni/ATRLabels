import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { LEDGER_TYPE_LABEL, listLedger, listOrderCharges } from "@/lib/ledger";
import OrderCharges from "@/components/OrderCharges";
import { money } from "@/lib/pricing";
import { buildStatement } from "@/lib/statement";

function monthRange(offset = 0) {
  const d = new Date();
  const f = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { from: f(new Date(d.getFullYear(), d.getMonth() + offset, 1)), to: f(new Date(d.getFullYear(), d.getMonth() + offset + 1, 0)) };
}

export default async function PortalBilling({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const me = await requireCustomer();
  const sp = await searchParams;
  const def = monthRange();
  const last = monthRange(-1);
  const from = sp.from ?? def.from;
  const to = sp.to ?? def.to;
  const st = buildStatement(me.id, from, to)!;
  const ledger = listLedger({ customerId: me.id, from, to });
  const charges = listOrderCharges(me.id, { from, to });
  const { supportContact } = getSettings();

  return (
    <>
      <h1>账户与账单</h1>
      <div className="stats">
        <div className="stat"><div className="muted">当前余额</div><div className="v">{money(me.balance)}</div></div>
        {me.creditLimit > 0 && <div className="stat"><div className="muted">信用额度</div><div className="v">{money(me.creditLimit)}</div></div>}
      </div>
      <p className="small muted">通过 <Link href="/portal/topup">充值</Link> 页面用 Zelle 或支付宝付款并提交申请，确认到账后会显示在下方流水中。{supportContact ? `有问题请联系：${supportContact}` : ""}</p>

      <form className="card row" method="get">
        <label className="f">开始日期<input type="date" name="from" defaultValue={from} /></label>
        <label className="f">结束日期<input type="date" name="to" defaultValue={to} /></label>
        <button className="primary">查询</button>
        <Link className="btn" href={`?from=${def.from}&to=${def.to}`}>本月</Link>
        <Link className="btn" href={`?from=${last.from}&to=${last.to}`}>上月</Link>
        <a className="btn" href={`/api/statement?from=${from}&to=${to}`}>下载对账单 CSV</a>
      </form>

      <div className="stats">
        <div className="stat"><div className="muted">面单运费</div><div className="v">{money(st.totals.labels)}</div></div>
        <div className="stat"><div className="muted">取消手续费</div><div className="v">{money(st.totals.cancels)}</div></div>
        <div className="stat"><div className="muted">账单补差</div><div className="v">{money(st.totals.adjustments)}</div></div>
        <div className="stat"><div className="muted">本期费用合计</div><div className="v">{money(st.totals.total)}</div></div>
      </div>

      <OrderCharges rows={charges} linkBase="/portal/shipments" exportHref={`/api/charges?from=${from}&to=${to}`} />

      <div className="card table-wrap">
        <h2>账户流水</h2>
        <table>
          <thead><tr><th>时间</th><th>类型</th><th>单号</th><th>说明</th><th className="num">金额</th><th className="num">余额</th></tr></thead>
          <tbody>
            {ledger.map((l) => (
              <tr key={l.id}>
                <td className="small muted">{l.createdAt}</td>
                <td>{LEDGER_TYPE_LABEL[l.type]}</td>
                <td>{l.shipmentId ? <Link href={`/portal/shipments/${l.shipmentId}`}>{l.customNo}</Link> : "-"}</td>
                <td className="small">{l.note}</td>
                <td className={`num ${l.amount >= 0 ? "profit-pos" : ""}`}>{l.amount >= 0 ? "+" : ""}{money(l.amount)}</td>
                <td className="num">{money(l.balanceAfter)}</td>
              </tr>
            ))}
            {!ledger.length && <tr><td colSpan={6} className="muted">这个期间没有流水</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
