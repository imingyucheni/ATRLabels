import Link from "next/link";
import { listChannels, listShipments, shipmentProfit } from "@/lib/db";
import { buildReport, localDate } from "@/lib/reports";
import { money } from "@/lib/pricing";
import StatusBadge from "@/components/StatusBadge";
import { pendingTopupCount } from "@/lib/topup";
import Profit from "@/components/Profit";
import { getT, tMsg } from "@/lib/prefs";

/** 和“报表”同一口径：订单数不含已取消 / 异常，含面单生成中的 */
function summarize(from: string, to: string) {
  const r = buildReport(from, to);
  const pending = listShipments({ from, to }).filter((s) => s.status === "pending").length;
  return { count: r.totals.orders, revenue: r.totals.revenue, profit: r.totals.profit, pending };
}

export default async function Dashboard() {
  const today = summarize(localDate(), localDate());
  const month = summarize(localDate().slice(0, 8) + "01", localDate());
  const attention = listShipments({ limit: 200 }).filter((s) =>
    ["pending", "exception", "cancel_requested"].includes(s.status),
  );
  const recent = listShipments({ limit: 10 });
  const noChannels = listChannels().length === 0;
  const pendingTopups = pendingTopupCount();
  const cur = recent[0]?.currency ?? "";
  const t = await getT();
  const errs = await Promise.all(attention.map((s) => tMsg(s.errorMsg)));

  return (
    <>
      <h1>{t("概览")}</h1>
      {pendingTopups > 0 && (
        <div className="alert warn">{t("有 {n} 笔客户充值待确认，", { n: pendingTopups })}<Link href="/finance#topups">{t("去处理")}</Link>{t("。")}</div>
      )}
      {noChannels && (
        <div className="alert warn">
          {t("还没有同步物流渠道，请先到")} <Link href="/settings">{t("设置")}</Link> {t("点“同步渠道”，并设置默认寄件地址和加价规则。")}
        </div>
      )}
      <div className="stats">
        <div className="stat"><div className="muted">{t("今日出单")}</div><div className="v">{today.count}</div>{today.pending > 0 && <div className="small muted">{t("含面单生成中 {n} 单", { n: today.pending })}</div>}</div>
        <div className="stat"><div className="muted">{t("今日收入")}</div><div className="v">{money(today.revenue)}</div></div>
        <div className="stat"><div className="muted">{t("今日利润")}</div><div className="v">{money(today.profit)}</div></div>
        <div className="stat"><div className="muted">{t("本月出单")}</div><div className="v">{month.count}</div></div>
        <div className="stat"><div className="muted">{t("本月利润")}</div><div className="v">{money(month.profit)}</div></div>
      </div>

      {attention.length > 0 && (
        <div className="card">
          <h2>{t("需要处理（{n}）", { n: attention.length })}</h2>
          <table>
            <tbody>
              {attention.map((s, i) => (
                <tr key={s.id}>
                  <td><Link href={`/shipments/${s.id}`}>{s.customNo}</Link></td>
                  <td>{s.customerName}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td className="small muted">{errs[i]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{t("最近面单")}</h2>
          <Link className="btn primary" href="/quote">{t("运费试算")}</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{t("单号")}</th><th>{t("客户")}</th><th>{t("渠道")}</th><th>{t("运单号")}</th><th>{t("状态")}</th><th className="num">{t("客户价")}</th><th className="num">{t("利润")}</th></tr>
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
              {!recent.length && <tr><td colSpan={7} className="muted">{t("暂无记录")}</td></tr>}
            </tbody>
          </table>
        </div>
        {cur && <p className="small muted">{t("金额币种以 ShipBest 返回为准（{cur}）。", { cur })}</p>}
      </div>
    </>
  );
}
