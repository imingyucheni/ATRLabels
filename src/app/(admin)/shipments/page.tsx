import { fmtTime } from "@/lib/time";
import Link from "next/link";
import { listCustomers, listShipments, shipmentCost, shipmentProfit, shipmentReceivable, STATUS_LABEL } from "@/lib/db";
import { money } from "@/lib/pricing";
import StatusBadge from "@/components/StatusBadge";
import Profit from "@/components/Profit";
import { getT } from "@/lib/prefs";

type SP = { customerId?: string; status?: string; from?: string; to?: string; q?: string };

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const t = await getT();
  const filter = {
    customerId: Number(sp.customerId) || undefined,
    status: sp.status || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
    q: sp.q || undefined,
  };
  const rows = listShipments({ ...filter, limit: 500 });
  const customers = listCustomers();
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

  return (
    <>
      <h1>{t("面单记录")}</h1>
      <form className="card row" method="get">
        <label className="f">{t("客户")}
          <select name="customerId" defaultValue={sp.customerId ?? ""}>
            <option value="">{t("全部")}</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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

      <div className="card table-wrap">
        <table className="list">
          <thead>
            <tr>
              <th>{t("时间")}</th><th>{t("单号")}</th><th>{t("客户")}</th><th>{t("收件人")}</th><th>{t("渠道")}</th><th>{t("运单号")}</th><th>{t("状态")}</th>
              <th className="num">{t("成本")}</th><th className="num">{t("客户价")}</th><th className="num">{t("补差(客户)")}</th><th className="num">{t("利润")}</th><th>{t("面单")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="small muted">{fmtTime(s.createdAt)}</td>
                <td><Link href={`/shipments/${s.id}`}>{s.customNo}</Link></td>
                <td>{s.customerName}</td>
                <td>{s.recipient.nameFirst} {s.recipient.nameLast}<div className="small muted">{s.recipient.city}, {s.recipient.province ?? s.recipient.country} {s.recipient.zipCode}</div></td>
                <td>{s.channelName}</td>
                <td>{s.trackingNo ?? "-"}</td>
                <td><StatusBadge status={s.status} /></td>
                <td className="num">{money(s.actualCost ?? s.quotedCost)}{s.actualCost === null && <div className="small muted">{t("试算")}</div>}</td>
                <td className="num">{money(s.price, s.currency)}</td>
                <td className="num">{s.costAdj || s.customerAdj ? <>{money(s.customerAdj)}<div className="small muted">{t("成本")} {money(s.costAdj)}</div></> : "-"}</td>
                <td className="num"><Profit value={shipmentProfit(s)} /></td>
                <td className="nowrap">{s.labelPath && s.status !== "cancelled" ? <a href={`/api/labels/${s.id}`} target="_blank">{t("打印")}</a> : s.status === "cancelled" ? <span className="muted small">{t("已作废")}</span> : "-"}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={12} className="muted">{t("没有符合条件的记录")}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="small muted">{t("时间为美西时间；成本优先显示 ShipBest 实扣（预报价），没有实扣时显示试算成本。合计已包含官方账单补差和取消费。")}</p>
    </>
  );
}
