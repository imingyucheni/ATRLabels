import { isPaperSize, PAPER_LABEL, type PaperSize } from "@/lib/labelLayout";
import { fmtTime } from "@/lib/time";
import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { STATUS_LABEL } from "@/lib/db";
import { listOwnShipments } from "@/lib/portal";
import { money } from "@/lib/pricing";
import StatusBadge from "@/components/StatusBadge";
import SelectPrint from "@/components/SelectPrint";

type SP = { status?: string; from?: string; to?: string; q?: string };

export default async function PortalShipments({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireCustomer();
  const sp = await searchParams;
  const rows = listOwnShipments(me.id, { status: sp.status || undefined, from: sp.from || undefined, to: sp.to || undefined, q: sp.q || undefined, limit: 500 });
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <h1>我的面单</h1>
      <form className="card row" method="get">
        <label className="f">状态
          <select name="status" defaultValue={sp.status ?? ""}>
            <option value="">全部</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="f">开始日期<input type="date" name="from" defaultValue={sp.from} /></label>
        <label className="f">结束日期<input type="date" name="to" defaultValue={sp.to} /></label>
        <label className="f" style={{ flex: 1, minWidth: 180 }}>搜索<input name="q" placeholder="订单号 / 运单号 / 收件人" defaultValue={sp.q} /></label>
        <button className="primary">筛选</button>
        <a className="btn" href={`/api/portal/export?${qs}`}>导出 CSV</a>
      </form>
      <SelectPrint
        paperNote={PAPER_LABEL[(isPaperSize(me.labelPaper) ? me.labelPaper : "4x6") as PaperSize]}
        rows={rows.map((s) => ({
          id: s.id,
          hasLabel: s.hasLabel,
          cells: [
            <span key="t" className="small muted">{fmtTime(s.createdAt)}</span>,
            <Link key="n" href={`/portal/shipments/${s.id}`}>{s.customerRef || s.customNo}</Link>,
            <span key="r">{s.recipient.nameFirst} {s.recipient.nameLast}<div className="small muted">{s.recipient.city}, {s.recipient.province ?? s.recipient.country} {s.recipient.zipCode}</div></span>,
            s.channelName,
            s.trackingNo ?? "-",
            <StatusBadge key="s" status={s.status} />,
            <span key="p">{money(s.price, s.currency)}{s.adjustment ? <div className="small muted">补差 {money(s.adjustment)}</div> : null}</span>,
          ],
        }))}
        headers={["时间", "订单号", "收件人", "渠道", "运单号", "状态", "运费"]}
        numericCols={[6]}
      />
    </>
  );
}
