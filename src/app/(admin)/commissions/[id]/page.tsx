import Link from "next/link";
import { notFound } from "next/navigation";
import FlashForm from "@/components/FlashForm";
import PinField from "@/components/PinField";
import StatusBadge from "@/components/StatusBadge";
import { commissionLines, currentAssignment, getSales, listPayouts } from "@/lib/commission";
import { listCustomers } from "@/lib/db";
import { money } from "@/lib/pricing";
import { localDate } from "@/lib/reports";
import { fmtTime } from "@/lib/time";
import { getT } from "@/lib/prefs";
import { saveSalesAction, settleCommissionAction } from "@/app/commissionActions";

export const dynamic = "force-dynamic";

export default async function SalesDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const rep = getSales(Number((await params).id));
  if (!rep) notFound();
  const t = await getT();
  const sp = await searchParams;
  const today = localDate();
  const from = sp.from || `${today.slice(0, 8)}01`;
  const to = sp.to || today;
  const lines = commissionLines({ salesId: rep.id, from, to });
  const allDue = commissionLines({ salesId: rep.id }).filter((l) => l.due !== 0);
  const dueTotal = allDue.reduce((a, l) => a + l.due, 0);
  const dueUpTo = allDue.filter((l) => l.date <= to).reduce((a, l) => a + l.due, 0);
  const payouts = listPayouts(rep.id);
  const customers = listCustomers().map((c) => ({ c, a: currentAssignment(c.id) })).filter((x) => x.a?.salesId === rep.id);
  const sum = (k: "profit" | "commission" | "due") => lines.reduce((a, l) => a + l[k], 0);
  const qs = `from=${from}&to=${to}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("销售：{name}", { name: rep.name })}{!rep.active && <> <span className="badge">{t("已停用")}</span></>}</h1>
          <p className="page-sub">{[rep.phone, rep.email, t("默认比例 {n}%", { n: rep.rate })].filter(Boolean).join(" · ")}{rep.note ? ` · ${rep.note}` : ""}</p>
        </div>
        <div className="row">
          <a className="btn" href={`/api/commissions/${rep.id}?${qs}`}>{t("导出明细 CSV")}</a>
          <Link href="/commissions">{t("← 返回")}</Link>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><div className="muted">{t("本期订单")}</div><div className="v">{lines.filter((l) => l.rate > 0).length}</div></div>
        <div className="stat"><div className="muted">{t("本期利润")}</div><div className="v">{money(sum("profit"))}</div></div>
        <div className="stat"><div className="muted">{t("本期佣金")}</div><div className="v">{money(sum("commission"))}</div></div>
        <div className="stat"><div className="muted">{t("未结算（全部）")}</div><div className={`v ${dueTotal > 0 ? "warn-text" : ""}`}>{money(dueTotal)}</div></div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{t("名下客户（{n}）", { n: customers.length })}</h2>
          {customers.length ? (
            <ul className="plain-list">
              {customers.map(({ c, a }) => (
                <li key={c.id}>
                  <Link href={`/customers/${c.id}?tab=pricing#sales`}>{c.name}</Link>
                  <span className="small muted"> · {a!.rate === null ? t("默认 {n}%", { n: rep.rate }) : `${a!.rate}%`} · {a!.startDate ? t("{d} 起", { d: a!.startDate }) : t("全部订单")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">{t("还没有客户。到客户详情 → 渠道与价格 → 销售归属里选择这个销售。")}</p>
          )}
        </div>

        <FlashForm action={settleCommissionAction} submitLabel="确认结算" className="card" review confirm={t("结算【{name}】截至所选日期还没结的佣金。结算后这些订单记为已结，之后利润有变化（例如补差）会在下一次结算里补差额。", { name: rep.name })}>
          <h2 style={{ marginTop: 0 }}>{t("结算佣金")}</h2>
          <p className="small muted" style={{ marginTop: -4 }}>{t("截至 {d} 未结：", { d: to })}<b>{money(dueUpTo)}</b>{t("（{n} 单）", { n: allDue.filter((l) => l.date <= to).length })}</p>
          <input type="hidden" name="salesId" value={rep.id} />
          <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
            <label className="f"><span className="req">{t("结算截止日期")}</span><input type="date" name="upTo" defaultValue={to} required /></label>
            <label className="f" style={{ flex: 1, minWidth: 160 }}>{t("备注")}<input name="note" maxLength={200} placeholder={t("例如 9 月佣金，Zelle 已付")} /></label>
            <PinField compact />
          </div>
        </FlashForm>
      </div>

      <form className="card row" method="get">
        <label className="f">{t("开始日期")}<input type="date" name="from" defaultValue={from} /></label>
        <label className="f">{t("结束日期")}<input type="date" name="to" defaultValue={to} /></label>
        <button className="primary">{t("查看")}</button>
      </form>

      <div className="card table-wrap">
        <h2 style={{ marginTop: 0 }}>{t("佣金明细（{from} ~ {to}）", { from, to })}</h2>
        <table className="card-table">
          <thead>
            <tr><th>{t("日期")}</th><th>{t("单号")}</th><th>{t("客户")}</th><th>{t("状态")}</th><th className="num">{t("利润")}</th><th className="num">{t("比例")}</th><th className="num">{t("佣金")}</th><th className="num">{t("已结")}</th><th className="num">{t("未结")}</th></tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.shipment.id}-${l.rate}`}>
                <td className="small muted" data-label={t("日期")}>{l.date}</td>
                <td className="c-main"><Link href={`/shipments/${l.shipment.id}`}>{l.shipment.customNo}</Link></td>
                <td data-label={t("客户")}>{l.shipment.customerName}</td>
                <td data-label={t("状态")}><StatusBadge status={l.shipment.status} /></td>
                <td className={`num ${l.profit < 0 ? "profit-neg" : ""}`} data-label={t("利润")}>{money(l.profit)}</td>
                <td className="num" data-label={t("比例")}>{l.rate > 0 ? `${l.rate}%` : <span className="small muted" title={t("结算后改归了别的销售，冲回")}>{t("已改归他人")}</span>}</td>
                <td className="num" data-label={t("佣金")}><b>{money(l.commission)}</b></td>
                <td className="num" data-label={t("已结")}>{l.paid ? money(l.paid) : "-"}</td>
                <td className={`num ${l.due ? "warn-text" : ""}`} data-label={t("未结")}>{l.due ? money(l.due) : "-"}</td>
              </tr>
            ))}
            {!lines.length && <tr><td colSpan={9} className="muted">{t("这段时间没有订单")}</td></tr>}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr><td colSpan={4}><b>{t("合计")}</b></td><td className="num">{money(sum("profit"))}</td><td></td><td className="num"><b>{money(sum("commission"))}</b></td><td></td><td className="num">{money(sum("due"))}</td></tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="card table-wrap">
        <h2 style={{ marginTop: 0 }}>{t("结算记录")}</h2>
        <table className="card-table">
          <thead><tr><th>{t("结算时间")}</th><th>{t("截止日期")}</th><th className="num">{t("订单")}</th><th className="num">{t("金额")}</th><th>{t("备注")}</th></tr></thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id}>
                <td className="small muted" data-label={t("结算时间")}>{fmtTime(p.createdAt)}</td>
                <td className="c-main">{t("截至 {d}", { d: p.periodTo })}</td>
                <td className="num" data-label={t("订单")}>{p.orders}</td>
                <td className="num" data-label={t("金额")}><b>{money(p.amount)}</b></td>
                <td className="small" data-label={t("备注")}>{p.note || "-"}</td>
              </tr>
            ))}
            {!payouts.length && <tr><td colSpan={5} className="muted">{t("还没有结算过")}</td></tr>}
          </tbody>
        </table>
      </div>

      <details className="card">
        <summary><b>{t("修改销售资料")}</b></summary>
        <FlashForm action={saveSalesAction} submitLabel="保存" review>
          <input type="hidden" name="id" value={rep.id} />
          <div className="grid" style={{ marginTop: 12 }}>
            <label className="f"><span className="req">{t("姓名")}</span><input name="name" required maxLength={60} defaultValue={rep.name} /></label>
            <label className="f"><span className="req">{t("默认佣金比例（利润的 %）")}</span><input name="rate" type="number" min="0" max="100" step="0.01" required defaultValue={rep.rate} /></label>
            <label className="f">{t("电话")}<input name="phone" type="tel" maxLength={40} defaultValue={rep.phone ?? ""} /></label>
            <label className="f">{t("邮箱")}<input name="email" type="email" maxLength={120} defaultValue={rep.email ?? ""} /></label>
            <label className="f">{t("状态")}
              <select name="active" defaultValue={rep.active ? "1" : "0"}><option value="1">{t("在职")}</option><option value="0">{t("已停用")}</option></select>
            </label>
            <label className="f" style={{ gridColumn: "1 / -1" }}>{t("备注")}<input name="note" maxLength={200} defaultValue={rep.note ?? ""} /></label>
          </div>
          <p className="small muted">{t("改默认比例：没有单独设比例的客户，还没结算的佣金都按新比例算。只想从某天起改，请到客户详情里按日期设置。")}</p>
        </FlashForm>
      </details>
    </>
  );
}
