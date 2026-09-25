import { fmtTime } from "@/lib/time";
import Link from "next/link";
import type { OrderCharge } from "@/lib/ledger";
import { STATUS_LABEL, type ShipmentStatus } from "@/lib/db";
import { money } from "@/lib/pricing";
import { getT } from "@/lib/prefs";

/** 按订单的扣款明细表（后台和客户端共用） */
export default async function OrderCharges({ rows, linkBase, exportHref }: { rows: OrderCharge[]; linkBase: string; exportHref: string }) {
  const t = await getT();
  const sum = (k: keyof OrderCharge) => rows.reduce((a, r) => a + (r[k] as number), 0);
  return (
    <div className="card table-wrap">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{t("按订单扣款明细")}</h2>
        <a className="btn small" href={exportHref}>{t("导出 CSV")}</a>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>{t("每一单的运费扣款、账单补差（补收为正、退还为负）、取消退款，以及这一单实际扣款合计。按下单日期筛选。")}</p>
      <table>
        <thead>
          <tr>
            <th>{t("下单时间")}</th><th>{t("单号")}</th><th>{t("运单号")}</th><th>{t("渠道")}</th><th>{t("状态")}</th>
            <th className="num">{t("运费")}</th><th className="num">{t("补差")}</th><th className="num">{t("取消退款")}</th><th className="num">{t("实际扣款")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.shipmentId}>
              <td className="small muted">{fmtTime(r.createdAt)}</td>
              <td><Link href={`${linkBase}/${r.shipmentId}`}>{r.customerRef || r.customNo}</Link>{r.customerRef && <div className="small muted">{r.customNo}</div>}</td>
              <td>{r.trackingNo ?? "-"}</td>
              <td>{r.channelName}</td>
              <td className="small">{STATUS_LABEL[r.status as ShipmentStatus] ? t(STATUS_LABEL[r.status as ShipmentStatus]) : r.status}</td>
              <td className="num">{money(r.freight)}</td>
              <td className="num">{r.adjustment ? money(r.adjustment) : "-"}</td>
              <td className="num">{r.refund ? <span className="profit-pos">-{money(r.refund)}</span> : "-"}</td>
              <td className="num"><b>{money(r.net)}</b></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={9} className="muted">{t("这个期间没有订单扣款")}</td></tr>}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={5}><b>{t("合计（{n} 单）", { n: rows.length })}</b></td>
              <td className="num"><b>{money(sum("freight"))}</b></td>
              <td className="num"><b>{money(sum("adjustment"))}</b></td>
              <td className="num"><b>-{money(sum("refund"))}</b></td>
              <td className="num"><b>{money(sum("net"))}</b></td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
