import Link from "next/link";
import { fmtTime } from "@/lib/time";
import { money } from "@/lib/pricing";
import { DISPUTE_STATUS_LABEL, listDisputes, type DisputeStatus } from "@/lib/disputes";
import { getT } from "@/lib/prefs";

/** 运费申诉：所有订单的申诉记录（申诉中的在前） */
export default async function DisputesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const t = await getT();
  const { status } = await searchParams;
  const st = (["open", "won", "lost"] as const).includes(status as DisputeStatus) ? (status as DisputeStatus) : undefined;
  const list = listDisputes(st ? { status: st } : {});
  const all = listDisputes();
  const won = all.filter((d) => d.status === "won");
  const count = (k: DisputeStatus) => all.filter((d) => d.status === k).length;
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{t("运费申诉")}</h1>
        <Link href="/adjustments">{t("← 返回")}</Link>
      </div>
      <p className="muted">{t("在订单详情页的“运费申诉”里记录、处理。申诉成功后服务商退回的钱按这一单的加价比例退给客户。")}</p>
      <div className="stats">
        <div className="stat"><div className="muted">{t("申诉中")}</div><div className={`v ${count("open") ? "profit-neg" : ""}`}>{count("open")}</div></div>
        <div className="stat"><div className="muted">{t("申诉成功")}</div><div className="v">{count("won")}</div><div className="small muted">{t("服务商退回 {c} · 退给客户 {u}", { c: money(won.reduce((a, d) => a + (d.refundCost ?? 0), 0)), u: money(won.reduce((a, d) => a + (d.refundCustomer ?? 0), 0)) })}</div></div>
        <div className="stat"><div className="muted">{t("未成功")}</div><div className="v">{count("lost")}</div></div>
      </div>
      <nav className="seg" style={{ marginBottom: 12 }}>
        <Link href="/adjustments/disputes" className={!st ? "on" : ""}>{t("全部")}</Link>
        {(["open", "won", "lost"] as const).map((k) => <Link key={k} href={`/adjustments/disputes?status=${k}`} className={st === k ? "on" : ""}>{t(DISPUTE_STATUS_LABEL[k])}</Link>)}
      </nav>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>{t("状态")}</th><th>{t("订单")}</th><th>{t("客户")}</th><th>{t("申诉的费用")}</th><th className="num">{t("申诉金额")}</th><th className="num">{t("服务商退回")}</th><th className="num">{t("退给客户")}</th><th>{t("时间")}</th></tr></thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <td><span className={`badge ${d.status === "won" ? "ok" : d.status === "lost" ? "cancelled" : "warn"}`}>{t(DISPUTE_STATUS_LABEL[d.status])}</span></td>
                <td><Link href={`/shipments/${d.shipmentId}#disputes`}>{d.customNo}</Link><div className="small muted">{d.trackingNo}</div></td>
                <td className="small">{d.customerName}</td>
                <td className="small">{d.reason}{d.note && <div className="muted">{d.note}</div>}</td>
                <td className="num">{d.claimAmount !== null ? money(d.claimAmount) : "-"}</td>
                <td className="num">{d.refundCost !== null ? money(d.refundCost) : "-"}</td>
                <td className="num">{d.refundCustomer !== null ? money(d.refundCustomer) : "-"}</td>
                <td className="small muted">{fmtTime(d.createdAt)}{d.resolvedAt && <div>{t("处理：")}{fmtTime(d.resolvedAt)}</div>}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={8} className="muted">{t("没有申诉记录")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
