import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { listOwnShipments } from "@/lib/portal";
import { money } from "@/lib/pricing";
import StatusBadge from "@/components/StatusBadge";

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function PortalHome() {
  const me = await requireCustomer();
  const { supportContact } = getSettings();
  const month = listOwnShipments(me.id, { from: localDate().slice(0, 8) + "01" });
  const recent = listOwnShipments(me.id, { limit: 8 });
  const attention = listOwnShipments(me.id, { limit: 200 }).filter((s) => ["pending", "exception", "cancel_requested"].includes(s.status));
  const monthSpend = month.filter((s) => s.status === "labeled" || s.status === "pending").reduce((a, s) => a + s.price, 0);
  const available = me.balance + me.creditLimit;

  return (
    <>
      <h1>你好，{me.name}</h1>
      {available <= 0 && <div className="alert err">账户余额不足（{money(me.balance)}），需要先 <Link href="/portal/topup">充值</Link> 才能继续下单。</div>}
      <div className="stats">
        <div className="stat"><div className="muted">账户余额</div><div className="v">{money(me.balance)}</div></div>
        {me.creditLimit > 0 && <div className="stat"><div className="muted">可用额度（含信用额度 {money(me.creditLimit)}）</div><div className="v">{money(available)}</div></div>}
        <div className="stat"><div className="muted">本月面单</div><div className="v">{month.filter((s) => s.status === "labeled").length}</div></div>
        <div className="stat"><div className="muted">本月运费</div><div className="v">{money(monthSpend)}</div></div>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <Link className="btn primary" href="/portal/ship">＋ 单个下单</Link>
        <Link className="btn" href="/portal/batch">批量下单（Excel）</Link>
        <Link className="btn" href="/portal/topup">充值</Link>
      </div>

      {attention.length > 0 && (
        <div className="card">
          <h2>处理中 / 需要注意</h2>
          <table>
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
        <h2>最近面单</h2>
        <table>
          <thead><tr><th>时间</th><th>单号</th><th>收件人</th><th>渠道</th><th>运单号</th><th>状态</th><th className="num">运费</th><th>面单</th></tr></thead>
          <tbody>
            {recent.map((s) => (
              <tr key={s.id}>
                <td className="small muted">{s.createdAt}</td>
                <td><Link href={`/portal/shipments/${s.id}`}>{s.customerRef || s.customNo}</Link></td>
                <td>{s.recipient.nameFirst} {s.recipient.nameLast}<div className="small muted">{s.recipient.city} {s.recipient.zipCode}</div></td>
                <td>{s.channelName}</td>
                <td>{s.trackingNo ?? "-"}</td>
                <td><StatusBadge status={s.status} /></td>
                <td className="num">{money(s.price, s.currency)}</td>
                <td>{s.hasLabel ? <a href={`/api/labels/${s.id}`} target="_blank">打印</a> : "-"}</td>
              </tr>
            ))}
            {!recent.length && <tr><td colSpan={8} className="muted">还没有面单，点“下单”开始</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
