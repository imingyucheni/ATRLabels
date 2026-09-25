import { fmtDate, fmtTime } from "@/lib/time";
import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { listOwnAdjustments } from "@/lib/portal";
import { money } from "@/lib/pricing";

export default async function PortalAdjustments() {
  const me = await requireCustomer();
  const rows = listOwnAdjustments(me.id);
  const batches = [...new Set(rows.map((r) => r.batchId))];
  const total = rows.reduce((a, r) => a + r.amount, 0);
  return (
    <>
      <h1>补差明细</h1>
      <p className="muted">
        下单时按预报重量和分区收费，承运商官方账单出来后，如果实际结算重量或分区不同，会多退少补。补差会自动从账户余额扣除或退回。
      </p>
      <div className="stats">
        <div className="stat"><div className="muted">补差合计</div><div className="v">{money(total)}</div></div>
        <div className="stat"><div className="muted">涉及面单</div><div className="v">{new Set(rows.map((r) => r.shipmentId)).size}</div></div>
      </div>
      {batches.length > 0 && (
        <div className="card row">
          <span className="muted">下载明细（含尺寸、结算重量、预报重量、重量差、分区）：</span>
          {batches.map((b) => {
            const first = rows.find((r) => r.batchId === b)!;
            return <a key={b} className="btn small" href={`/api/adjustments/${b}/export`}>{fmtDate(first.createdAt)} 批次</a>;
          })}
        </div>
      )}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>日期</th><th>单号</th><th>运单号</th><th>原因</th><th className="num">补收(+)/退还(-)</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="small muted">{fmtTime(r.createdAt)}</td>
                <td><Link href={`/portal/shipments/${r.shipmentId}`}>{r.customNo}</Link></td>
                <td>{r.trackingNo}</td>
                <td className="small">{r.reason}</td>
                <td className="num">{money(r.amount)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="muted">没有补差记录</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
