import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { localDate, presetRanges } from "@/lib/reports";
import { staffDashboard } from "@/lib/staffDashboard";
import { money } from "@/lib/pricing";
import { getLang, getT } from "@/lib/prefs";
import { fmtTime } from "@/lib/time";
import { displayChannel } from "@/lib/channelDisplay";
import { localizeChannelName } from "@/lib/carriers";
import StatusBadge from "@/components/StatusBadge";
import TrackingLink from "@/components/TrackingLink";
import Profit from "@/components/Profit";
import { shipmentProfit } from "@/lib/db";

export const dynamic = "force-dynamic";

type SP = { from?: string; to?: string; range?: string };

/** 员工的“我的看板”：自己负责的客户的消费、面单数、成本、利润，以及自己的提成 */
export default async function MyDashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const who = await requireAdmin({ staff: true });
  // 主管理员看“概览”和“报表”
  if (who.role !== "staff") redirect("/");
  const sp = await searchParams;
  const t = await getT();
  const lang = await getLang();
  const presets = presetRanges();
  const preset = presets.find((p) => p.key === (sp.range ?? (sp.from ? "" : "month")));
  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  let from = preset?.from ?? day(sp.from) ?? presets[3].from;
  let to = preset?.to ?? day(sp.to) ?? localDate();
  if (from > to) [from, to] = [to, from];
  const d = staffDashboard(who, from, to);
  const c = d.commission;
  const margin = d.totals.revenue ? (d.totals.profit / d.totals.revenue) * 100 : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("我的看板")}</h1>
          <p className="page-sub">{t("{from} 至 {to} · 你负责的客户（授权给你的、归你名下的）", { from, to })}</p>
        </div>
        <Link className="btn" href="/customers">{t("客户管理")}</Link>
      </div>

      <div className="filter-bar">
        <div className="seg">
          {presets.map((p) => <Link key={p.key} href={`?range=${p.key}`} className={preset?.key === p.key ? "on" : ""}>{t(p.label)}</Link>)}
        </div>
        <form className="row" method="get">
          <input type="date" name="from" defaultValue={from} aria-label={t("开始日期")} />
          <span className="muted">—</span>
          <input type="date" name="to" defaultValue={to} aria-label={t("结束日期")} />
          <button>{t("应用")}</button>
        </form>
      </div>

      <div className="stats">
        <div className="stat"><div className="muted">{t("客户数")}</div><div className="v">{d.totals.customers}</div></div>
        <div className="stat"><div className="muted">{t("面单数")}</div><div className="v">{d.totals.orders}</div>{d.totals.cancelled > 0 && <div className="small muted">{t("另取消 {n} 单", { n: d.totals.cancelled })}</div>}</div>
        <div className="stat"><div className="muted">{t("客户消费")}</div><div className="v">{money(d.totals.revenue)}</div></div>
        <div className="stat"><div className="muted">{t("成本")}</div><div className="v">{money(d.totals.cost)}</div></div>
        <div className="stat"><div className="muted">{t("利润")}</div><div className="v">{money(d.totals.profit)}</div><div className="small muted">{t("利润率 {p}%", { p: margin.toFixed(1) })}</div></div>
        <div className="stat"><div className="muted">{t("我的提成（本期）")}</div><div className="v">{c ? money(c.commission) : "—"}</div><div className="small muted">{c ? t("未结算 {v}", { v: money(c.due) }) : t("还没有绑定提成")}</div></div>
      </div>
      {d.tests > 0 && <p className="small muted" style={{ marginTop: -8 }}>{t("测试单不计入以上统计（本期 {n} 单测试单）。", { n: d.tests })}</p>}

      <div className="card">
        <h2>{t("我的提成")}</h2>
        {c ? (
          <>
            <p className="small muted" style={{ marginTop: 0 }}>
              {t("提成按客户算：归你名下的每个客户有自己的比例（例如利润的 5%），提成 = 这个客户每单的利润 × 比例；没绑定销售的客户利润归公司。亏损单冲减提成，取消单按手续费差额算，补差会影响利润。客户归属和比例由主管理员设置，结算也由主管理员操作。")}
            </p>
            <div className="stats" style={{ margin: 0 }}>
              <div className="stat"><div className="muted">{t("销售")}</div><div className="v" style={{ fontSize: 18 }}>{c.rep.name}</div></div>
              <div className="stat"><div className="muted">{t("本期提成订单")}</div><div className="v">{c.orders}</div></div>
              <div className="stat"><div className="muted">{t("本期利润")}</div><div className="v">{money(c.profit)}</div></div>
              <div className="stat"><div className="muted">{t("本期提成")}</div><div className="v">{money(c.commission)}</div></div>
              <div className="stat"><div className="muted">{t("未结算（全部）")}</div><div className="v">{money(c.due)}</div></div>
              <div className="stat"><div className="muted">{t("已结算合计")}</div><div className="v">{money(c.paidTotal)}</div></div>
            </div>
            {c.noRate > 0 && <div className="alert warn" style={{ marginTop: 12 }}>{t("本期有 {n} 单的客户还没设提成比例，这些单暂时按 0 算，请找主管理员设置。", { n: c.noRate })}</div>}
            {c.payouts.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="card-table">
                  <thead><tr><th>{t("结算时间")}</th><th>{t("结算到")}</th><th className="num">{t("订单")}</th><th className="num">{t("金额")}</th><th>{t("备注")}</th></tr></thead>
                  <tbody>
                    {c.payouts.map((p) => (
                      <tr key={p.id}>
                        <td data-label={t("结算时间")}>{fmtTime(p.createdAt)}</td>
                        <td data-label={t("结算到")}>{p.periodTo}</td>
                        <td className="num" data-label={t("订单")}>{p.orders}</td>
                        <td className="num" data-label={t("金额")}>{money(p.amount)}</td>
                        <td className="small muted" data-label={t("备注")}>{p.note ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <p className="muted" style={{ marginBottom: 0 }}>{t("你的账号还没有绑定销售。请找主管理员在“员工账号”里给你绑定，再把你负责的客户绑定到你名下并设好比例，看板里就会显示你的提成。")}</p>
        )}
      </div>

      <div className="card">
        <h2>{t("客户（{n}）", { n: d.customers.length })}</h2>
        <div className="table-wrap">
          <table className="card-table">
            <thead><tr><th>{t("客户")}</th><th className="num">{t("面单数")}</th><th className="num">{t("客户消费")}</th><th className="num">{t("成本")}</th><th className="num">{t("利润")}</th><th className="num">{t("余额")}</th><th>{t("最近下单")}</th><th>{t("提成归属")}</th></tr></thead>
            <tbody>
              {d.customers.map((r) => (
                <tr key={r.id}>
                  <td className="c-main">{r.canOpen ? <Link href={`/customers/${r.id}`}>{r.name}</Link> : r.name}</td>
                  <td className="num" data-label={t("面单数")}>{r.orders}{r.cancelled > 0 && <div className="small muted">{t("取消 {n}", { n: r.cancelled })}</div>}</td>
                  <td className="num" data-label={t("客户消费")}>{money(r.revenue)}</td>
                  <td className="num" data-label={t("成本")}>{money(r.cost)}</td>
                  <td className="num" data-label={t("利润")}><Profit value={r.profit} /></td>
                  <td className={`num${r.balance < 0 ? " profit-neg" : ""}`} data-label={t("余额")}>{money(r.balance)}</td>
                  <td className="small muted" data-label={t("最近下单")}>{r.lastAt ? fmtTime(r.lastAt) : "-"}</td>
                  <td className="small" data-label={t("提成归属")}>{r.mine ? <><b>{t("我")}</b> · {r.rate !== null ? `${r.rate}%` : <span className="warn-text">{t("未设比例")}</span>}</> : r.salesName ?? <span className="muted">{t("公司（未绑定销售）")}</span>}</td>
                </tr>
              ))}
              {!d.customers.length && <tr><td colSpan={8} className="muted">{t("还没有授权给你的客户。你新开的客户会自动出现在这里。")}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>{t("本期订单（最近 {n} 单）", { n: d.recent.length })}</h2>
        <div className="table-wrap">
          <table className="card-table">
            <thead><tr><th>{t("下单时间")}</th><th>{t("客户")}</th><th>{t("渠道")}</th><th>{t("运单号")}</th><th>{t("状态")}</th><th className="num">{t("客户价")}</th><th className="num">{t("成本")}</th><th className="num">{t("利润")}</th></tr></thead>
            <tbody>
              {d.recent.map((s) => (
                <tr key={s.id}>
                  <td className="c-main small">{fmtTime(s.createdAt)}<div className="muted">{s.customerRef || s.customNo}</div></td>
                  <td data-label={t("客户")}>{s.customerName}</td>
                  <td className="small" data-label={t("渠道")}>{localizeChannelName(displayChannel(s.channelCode).name || s.channelName || "", lang)}</td>
                  <td className="small" data-label={t("运单号")}><TrackingLink channelCode={s.channelCode} trackingNo={s.trackingNo} title={t("查物流轨迹")} /></td>
                  <td data-label={t("状态")}><StatusBadge status={s.status} test={s.isTest} /></td>
                  <td className="num" data-label={t("客户价")}>{money(s.price, s.currency)}</td>
                  <td className="num" data-label={t("成本")}>{money(s.actualCost ?? s.quotedCost)}</td>
                  <td className="num" data-label={t("利润")}><Profit value={s.status === "exception" ? null : shipmentProfit(s)} /></td>
                </tr>
              ))}
              {!d.recent.length && <tr><td colSpan={8} className="muted">{t("这段时间没有订单")}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
