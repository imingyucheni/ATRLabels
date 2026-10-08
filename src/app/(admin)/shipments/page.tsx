import { fmtTime } from "@/lib/time";
import Link from "next/link";
import { redirect } from "next/navigation";
import { displayChannel } from "@/lib/channelDisplay";
import { describeRule, MARKUP_SOURCE_LABEL, type MarkupSource } from "@/lib/markup";
import { listCustomers, listShipments, shipmentCost, shipmentProfit, shipmentReceivable, STATUS_LABEL } from "@/lib/db";
import { money, signedPercent } from "@/lib/pricing";
import StatusBadge from "@/components/StatusBadge";
import Profit from "@/components/Profit";
import TrackingLink from "@/components/TrackingLink";
import { getLang, getT } from "@/lib/prefs";
import { listLabelFailures } from "@/lib/providerLog";
import { customerLabeler } from "@/lib/customerLabel";
import { localizeChannelName } from "@/lib/carriers";

type SP = { customerId?: string; status?: string; from?: string; to?: string; q?: string };

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const t = await getT();
  const lang = await getLang();
  const filter = {
    customerId: Number(sp.customerId) || undefined,
    status: sp.status || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
    q: sp.q || undefined,
  };
  const rows = listShipments({ ...filter, limit: 500 });
  const hasAdj = rows.some((s) => s.costAdj || s.customerAdj);
  // 按单号 / 运单号搜到唯一一单：直接打开详情（手机上查件少点一步）
  if (filter.q && rows.length === 1 && !filter.status && !filter.from && !filter.to && !filter.customerId) redirect(`/shipments/${rows[0].id}`);
  const customers = listCustomers({ includeInternal: true });
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();

  const totals = rows.reduce(
    (acc, s) => {
      acc.cost += shipmentCost(s);
      acc.revenue += shipmentReceivable(s);
      acc.profit += shipmentProfit(s) ?? 0;
      return acc;
    },
    { cost: 0, revenue: 0, profit: 0 },
  );

  const failures = listLabelFailures(30);
  return (
    <>
      <h1>{t("面单记录")}</h1>
      {failures.length > 0 && (
        <details className="card">
          <summary style={{ cursor: "pointer" }}>
            <b>{t("最近出单失败")}</b> <span className="muted small">{t("（服务商 / 承运商拒绝出单，订单没有建成、已退回扣款；最近 {n} 条）", { n: failures.length })}</span>
          </summary>
          <p className="small muted">{t("同一个渠道连续失败、其他渠道正常：多半是这个渠道暂时有问题，可以把原话发给服务商查。换了品名 / 包裹后能出单：是这单的内容被拦。")}</p>
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>{t("时间")}</th><th>{t("客户")}</th><th>{t("渠道")}</th><th>{t("订单号")}</th><th>{t("收件地")}</th><th>{t("包裹")}</th><th>{t("品名")}</th><th>{t("对方返回")}</th></tr></thead>
              <tbody>
                {failures.map((f) => (
                  <tr key={f.id}>
                    <td className="small muted">{fmtTime(f.createdAt)}</td>
                    <td className="wrap">{f.customerName}</td>
                    <td className="wrap">{f.channelName}<div className="small muted">{f.channelCode}</div></td>
                    <td>{f.customerRef ?? "-"}</td>
                    <td className="small">{f.recipient}</td>
                    <td className="small">{f.pkg}</td>
                    <td className="small wrap">{f.items}</td>
                    <td className="small wrap wide" style={{ color: "var(--err)" }}>{f.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <form className="card row" method="get">
        <label className="f">{t("客户")}
          <select name="customerId" defaultValue={sp.customerId ?? ""}>
            <option value="">{t("全部")}</option>
            {customers.map((c, _i, all) => <option key={c.id} value={c.id}>{customerLabeler(all)(c)}</option>)}
          </select>
        </label>
        <label className="f">{t("状态")}
          <select name="status" defaultValue={sp.status ?? ""}>
            <option value="">{t("全部")}</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
        </label>
        <label className="f">{t("开始日期")}<input type="date" name="from" defaultValue={sp.from} /></label>
        <label className="f">{t("结束日期")}<input type="date" name="to" defaultValue={sp.to} /></label>
        <label className="f" style={{ flex: 1, minWidth: 180 }}>{t("搜索")}<input name="q" placeholder={t("单号 / 运单号 / 收件人")} defaultValue={sp.q} /></label>
        <button className="primary">{t("筛选")}</button>
        <a className="btn" href={`/api/export?${qs}`}>{t("导出 CSV")}</a>
      </form>

      <div className="stats">
        <div className="stat"><div className="muted">{t("记录数")}</div><div className="v">{rows.length}</div></div>
        <div className="stat"><div className="muted">{t("成本合计")}</div><div className="v">{money(totals.cost)}</div></div>
        <div className="stat"><div className="muted">{t("应收客户")}</div><div className="v">{money(totals.revenue)}</div></div>
        <div className="stat"><div className="muted">{t("利润合计")}</div><div className="v">{money(totals.profit)}</div></div>
      </div>

      {/* 补差列只在有补差的记录时显示；加价并到客户价下面：列少一些，1440 宽的屏幕不用横向滚动 */}
      <div className="card table-wrap">
        <table className="list card-table ship-list">
          <thead>
            <tr>
              <th>{t("单号")} / {t("时间")}</th><th>{t("客户")}</th><th>{t("收件人")}</th><th>{t("渠道")}</th><th>{t("运单号")}</th><th>{t("状态")}</th>
              <th className="num">{t("成本")}</th><th className="num">{t("客户价")}</th>{hasAdj && <th className="num" title={t("补差(客户)")}>{t("补差")}</th>}<th className="num">{t("利润")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="c-main"><Link href={`/shipments/${s.id}`}>{s.customNo}</Link><div className="small muted">{fmtTime(s.createdAt)}</div></td>
                <td className="wrap" data-label={t("客户")}>{s.customerName}</td>
                <td className="wrap" data-label={t("收件人")}>{s.recipient.nameFirst} {s.recipient.nameLast}<div className="small muted">{s.recipient.city}, {s.recipient.province ?? s.recipient.country} {s.recipient.zipCode}</div></td>
                <td className="wrap" data-label={t("渠道")} title={s.channelName ?? undefined}>{localizeChannelName(displayChannel(s.channelCode).name || s.channelName || "", lang)}</td>
                <td data-label={t("运单号")} className="small ship-trk">
                  <TrackingLink channelCode={s.channelCode} trackingNo={s.trackingNo} title={t("查物流轨迹")} />
                  <div className="ship-print">{s.labelPath && s.status !== "cancelled" ? <a href={`/api/labels/${s.id}`} target="_blank">{t("打印面单")}</a> : s.status === "cancelled" ? <span className="muted">{t("已作废")}</span> : null}</div>
                </td>
                <td data-label={t("状态")}><StatusBadge status={s.status} test={s.isTest} /></td>
                <td className="num" data-label={t("成本")}>{money(s.actualCost ?? s.quotedCost)}{s.actualCost === null && <div className="small muted">{t("试算")}</div>}</td>
                <td className="num nowrap" data-label={t("客户价")}>
                  {money(s.price, s.currency)}
                  <div className="small muted" title={`${describeRule(s.rule, undefined, t)}${s.rule.source ? ` · ${t(MARKUP_SOURCE_LABEL[s.rule.source as MarkupSource] ?? s.rule.source)}` : ""}`}>
                    {t("加价")} {signedPercent(s.rule.percent)}{s.rule.fixed ? ` +${money(s.rule.fixed)}` : ""}
                  </div>
                </td>
                {hasAdj && <td className="num" data-label={t("补差(客户)")}>{s.costAdj || s.customerAdj ? <>{money(s.customerAdj)}<div className="small muted">{t("成本")} {money(s.costAdj)}</div></> : "-"}</td>}
                <td className="num" data-label={t("利润")}><Profit value={shipmentProfit(s)} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={hasAdj ? 10 : 9} className="muted">{t("没有符合条件的记录")}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="small muted">{t("时间为美西时间；成本优先显示 ShipBest 实扣（预报价），没有实扣时显示试算成本。合计已包含官方账单补差和取消费。")}</p>
    </>
  );
}
