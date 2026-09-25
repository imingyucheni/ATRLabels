import { isPaperSize, PAPER_LABEL, type PaperSize } from "@/lib/labelLayout";
import ChannelLabel from "@/components/ChannelLabel";
import { fmtTime } from "@/lib/time";
import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { STATUS_LABEL } from "@/lib/db";
import { listOwnShipments } from "@/lib/portal";
import { money } from "@/lib/pricing";
import StatusBadge from "@/components/StatusBadge";
import SelectPrint from "@/components/SelectPrint";
import { getT } from "@/lib/prefs";

type SP = { status?: string; from?: string; to?: string; q?: string };

export default async function PortalShipments({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireCustomer();
  const sp = await searchParams;
  const t = await getT();
  const rows = listOwnShipments(me.id, { status: sp.status || undefined, from: sp.from || undefined, to: sp.to || undefined, q: sp.q || undefined, limit: 500 });
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <h1>{t("我的面单")}</h1>
      <form className="card row" method="get">
        <label className="f">{t("状态")}
          <select name="status" defaultValue={sp.status ?? ""}>
            <option value="">{t("全部")}</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
        </label>
        <label className="f">{t("开始日期")}<input type="date" name="from" defaultValue={sp.from} /></label>
        <label className="f">{t("结束日期")}<input type="date" name="to" defaultValue={sp.to} /></label>
        <label className="f" style={{ flex: 1, minWidth: 180 }}>{t("搜索")}<input name="q" placeholder={t("订单号 / 运单号 / 收件人")} defaultValue={sp.q} /></label>
        <button className="primary">{t("筛选")}</button>
        <a className="btn" href={`/api/portal/export?${qs}`}>{t("导出 CSV")}</a>
      </form>
      <SelectPrint
        paperNote={t(PAPER_LABEL[(isPaperSize(me.labelPaper) ? me.labelPaper : "4x6") as PaperSize])}
        rows={rows.map((s) => ({
          id: s.id,
          hasLabel: s.hasLabel,
          cells: [
            <span key="n"><Link href={`/portal/shipments/${s.id}`}>{s.customerRef || s.customNo}</Link><div className="small muted">{fmtTime(s.createdAt)}</div></span>,
            <span key="r" className="cell-wrap">{s.recipient.nameFirst} {s.recipient.nameLast}<div className="small muted">{s.recipient.city}, {s.recipient.province ?? s.recipient.country} {s.recipient.zipCode}</div></span>,
            <span key="c" className="cell-wrap"><ChannelLabel code={s.channelCode} name={s.channelName} /></span>,
            s.trackingNo ?? "-",
            <StatusBadge key="s" status={s.status} test={s.isTest} />,
            <span key="p">{money(s.price, s.currency)}{s.adjustment ? <div className="small muted">{t("补差")} {money(s.adjustment)}</div> : null}</span>,
          ],
        }))}
        headers={[`${t("订单号")} / ${t("时间")}`, ...["收件人", "渠道", "运单号", "状态", "运费"].map((h) => t(h))]}
        numericCols={[5]}
      />
    </>
  );
}
