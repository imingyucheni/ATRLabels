import Link from "next/link";
import { listChannels, listShipments, shipmentProfit, shipmentReceivable } from "@/lib/db";
import { money } from "@/lib/pricing";
import StatusBadge from "@/components/StatusBadge";
import { pendingTopupCount } from "@/lib/topup";
import Profit from "@/components/Profit";

function localDate(offsetDays = 0) {
  const d = new Date(Date.now() - offsetDays * 86400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function summarize(rows: ReturnType<typeof listShipments>) {
  return {
    count: rows.filter((s) => s.status === "labeled").length,
    revenue: rows.reduce((a, s) => a + shipmentReceivable(s), 0),
    profit: rows.reduce((a, s) => a + (shipmentProfit(s) ?? 0), 0),
  };
}

export default async function Dashboard() {
  const today = summarize(listShipments({ from: localDate() }));
  const month = summarize(listShipments({ from: localDate().slice(0, 8) + "01" }));
  const attention = listShipments({ limit: 200 }).filter((s) =>
    ["pending", "exception", "cancel_requested"].includes(s.status),
  );
  const recent = listShipments({ limit: 10 });
  const noChannels = listChannels().length === 0;
  const pendingTopups = pendingTopupCount();
  const cur = recent[0]?.currency ?? "";

  return (
    <>
      <h1>概览</h1>
      {pendingTopups > 0 && (
        <div className="alert warn">有 {pendingTopups} 笔客户充值待确认，<Link href="/finance#topups">去处理</Link>。</div>
      )}
      {noChannels && (
        <div className="alert warn">
          还没有同步物流渠道，请先到 <Link href="/settings">设置</Link> 点“同步渠道”，并设置默认寄件地址和加价规则。
        </div>
      )}
      <div className="stats">
        <div className="stat"><div className="muted">今日出单</div><div className="v">{today.count}</div></div>
        <div className="stat"><div className="muted">今日收入</div><div className="v">{money(today.revenue)}</div></div>
        <div className="stat"><div className="muted">今日利润</div><div className="v">{money(today.profit)}</div></div>
        <div className="stat"><div className="muted">本月出单</div><div className="v">{month.count}</div></div>
        <div className="stat"><div className="muted">本月利润</div><div className="v">{money(month.profit)}</div></div>
      </div>

      {attention.length > 0 && (
        <div className="card">
          <h2>需要处理（{attention.length}）</h2>
          <table>
            <tbody>
              {attention.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/shipments/${s.id}`}>{s.customNo}</Link></td>
                  <td>{s.customerName}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td className="small muted">{s.errorMsg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>最近面单</h2>
          <Link className="btn primary" href="/shipments/new">＋ 新建面单</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>单号</th><th>客户</th><th>渠道</th><th>运单号</th><th>状态</th><th className="num">客户价</th><th className="num">利润</th></tr>
            </thead>
            <tbody>
              {recent.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/shipments/${s.id}`}>{s.customNo}</Link></td>
                  <td>{s.customerName}</td>
                  <td>{s.channelName}</td>
                  <td>{s.trackingNo ?? "-"}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td className="num">{money(s.price, s.currency)}</td>
                  <td className="num"><Profit value={shipmentProfit(s)} /></td>
                </tr>
              ))}
              {!recent.length && <tr><td colSpan={7} className="muted">暂无记录</td></tr>}
            </tbody>
          </table>
        </div>
        {cur && <p className="small muted">金额币种以 ShipBest 返回为准（{cur}）。</p>}
      </div>
    </>
  );
}
