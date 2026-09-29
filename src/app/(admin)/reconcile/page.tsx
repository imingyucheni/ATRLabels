import Link from "next/link";
import { money } from "@/lib/pricing";
import { localDate } from "@/lib/reports";
import { buildRecon, PROVIDERS, reconPresets, type ProviderKey, type ReconTotals } from "@/lib/providerRecon";
import { getT } from "@/lib/prefs";
import type { T } from "@/lib/i18n";

type SP = { from?: string; to?: string; range?: string; provider?: string };

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");

/** 一行汇总数字（服务商卡片顶部 / 全部合计） */
function Summary({ t, tr, big }: { t: ReconTotals; tr: T; big?: boolean }) {
  return (
    <div className={`recon-sum${big ? " big" : ""}`}>
      <div><span>{tr("出单数")}</span><b>{t.labels}</b><small>{tr("单")}</small></div>
      <div><span>{tr("邮费")}</span><b>{money(t.postage)}</b><small>{t.labels ? tr("单均 {v}", { v: money(t.postage / t.labels) }) : ""}</small></div>
      <div><span>{tr("取消单")}</span><b>{t.cancelled}</b><small>{tr("取消费 {v}", { v: money(t.cancelFees) })}</small></div>
      <div><span>{tr("补差")}</span><b className={t.adjustments < 0 ? "profit-pos" : ""}>{money(t.adjustments)}</b><small>{tr("{n} 笔", { n: t.adjCount })}</small></div>
      <div className="total"><span>{tr("应付合计")}</span><b>{money(t.total)}</b><small>{tr("邮费 + 取消费 + 补差")}</small></div>
      {t.rebate > 0 && <div><span>{tr("预计返利")}</span><b className="profit-pos">{money(t.rebate)}</b><small>{tr("限时活动，服务商应返给我们")}</small></div>}
    </div>
  );
}

export default async function ReconcilePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const tr = await getT();
  const presets = reconPresets();
  const preset = presets.find((p) => p.key === (sp.range ?? (sp.from ? "" : "lastweek")));
  let from = preset?.from ?? sp.from ?? presets[1].from;
  let to = preset?.to ?? sp.to ?? localDate();
  if (from > to) [from, to] = [to, from];
  const only = PROVIDERS.some((p) => p.key === sp.provider) ? (sp.provider as ProviderKey) : undefined;

  const r = buildRecon(from, to);
  const shown = r.providers.filter((p) => !only || p.key === only);
  const exportQs = (type: string, provider?: string) =>
    `/api/recon?${new URLSearchParams({ type, from, to, ...(provider ? { provider } : {}) }).toString()}`;
  const keep = (extra: Record<string, string | undefined>) =>
    "?" + new URLSearchParams(Object.entries({ provider: only, ...extra }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{tr("服务商对账")}</h1>
          <p className="page-sub">{tr("{from} 至 {to} · 邮费、取消按下单日期统计，补差按导入日期统计；只算正式单", { from, to })}</p>
        </div>
        <div className="row">
          <a className="btn" href={exportQs("channel", only)}>{tr("导出渠道汇总")}</a>
          <a className="btn" href={exportQs("lines", only)}>{tr("导出订单明细")}</a>
        </div>
      </div>

      <div className="filter-bar">
        <div className="seg">
          {presets.map((p) => (
            <Link key={p.key} href={keep({ range: p.key })} className={preset?.key === p.key ? "on" : ""}>{tr(p.label)}</Link>
          ))}
        </div>
        <form className="row" method="get">
          <input type="date" name="from" defaultValue={from} aria-label={tr("开始日期")} />
          <span className="muted">—</span>
          <input type="date" name="to" defaultValue={to} aria-label={tr("结束日期")} />
          <select name="provider" defaultValue={only ?? ""} aria-label={tr("服务商")}>
            <option value="">{tr("全部服务商")}</option>
            {PROVIDERS.map((p) => <option key={p.key} value={p.key}>{tr(p.name)}（{p.tag}）</option>)}
          </select>
          <button>{tr("应用")}</button>
        </form>
      </div>

      {!only && r.providers.length > 1 && (
        <section className="card">
          <div className="card-head"><h2>{tr("全部服务商合计")}</h2></div>
          <div className="row" style={{ gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            {r.providers.map((p) => (
              <span key={p.key} className="badge" style={{ fontSize: 14, padding: "6px 12px" }}>{tr("{name} 本期应付", { name: tr(p.name) })} <b>{money(p.totals.total)}</b></span>
            ))}
          </div>
          <Summary t={r.grand} tr={tr} big />
        </section>
      )}

      {r.unmatchedAdj.count > 0 && !only && (
        <div className="alert warn">
          {tr("期间内还有 {n} 笔补差（{amt}）没有对应到订单，不知道属于哪家服务商，没有计入上面的合计。", { n: r.unmatchedAdj.count, amt: money(r.unmatchedAdj.amount) })}{" "}
          <Link href="/adjustments">{tr("去补差导入查看")}</Link>
        </div>
      )}

      {!shown.length && <div className="card"><p className="muted" style={{ margin: 0 }}>{tr("这个期间没有向服务商下单的记录。")}</p></div>}

      {shown.map((p) => {
        const t = p.totals;
        const activeDays = p.daily.filter((d) => d.labels || d.cancelled || d.adjCount || d.exceptions);
        return (
          <section className="card recon-card" key={p.key} id={p.key}>
            <div className="card-head">
              <h2>{tr(p.name)} <span className="badge">{p.tag}</span></h2>
              <div className="row" style={{ gap: 8 }}>
                <a className="btn small" href={exportQs("lines", p.key)}>{tr("订单明细")}</a>
                <a className="btn small" href={exportQs("channel", p.key)}>{tr("渠道汇总")}</a>
                {t.adjCount > 0 && <a className="btn small" href={exportQs("adjustments", p.key)}>{tr("补差明细")}</a>}
              </div>
            </div>
            <Summary t={t} tr={tr} />
            {t.exceptions > 0 && (
              <div className="alert warn small" style={{ marginTop: 12 }}>
                {tr("另有 {n} 单出单异常（试算邮费 {amt}）没有计入应付，请和服务商确认这些单有没有扣费。", { n: t.exceptions, amt: money(t.exceptionCost) })}{" "}
                <Link href="/shipments?status=exception">{tr("查看异常单")}</Link>
              </div>
            )}

            <h3>{tr("按渠道")}</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{tr("渠道")}</th><th className="num">{tr("出单数")}</th><th className="num">{tr("占比")}</th><th className="num">{tr("邮费")}</th>
                    <th className="num">{tr("单均邮费")}</th><th className="num">{tr("取消单")}</th><th className="num">{tr("取消费")}</th>
                    <th className="num">{tr("补差")}</th><th className="num">{tr("应付合计")}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.channels.map((c) => (
                    <tr key={c.code}>
                      <td>{c.name}<div className="small muted">{c.code}</div></td>
                      <td className="num">{c.labels}</td>
                      <td className="num">{pct(c.labels, t.labels)}</td>
                      <td className="num">{money(c.postage)}</td>
                      <td className="num">{c.labels ? money(c.postage / c.labels) : "—"}</td>
                      <td className="num">{c.cancelled || ""}</td>
                      <td className="num">{c.cancelFees ? money(c.cancelFees) : ""}</td>
                      <td className="num">{c.adjCount ? money(c.adjustments) : ""}</td>
                      <td className="num"><b>{money(c.total)}</b></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td><b>{tr("合计")}</b></td><td className="num"><b>{t.labels}</b></td><td className="num"></td><td className="num"><b>{money(t.postage)}</b></td>
                    <td className="num">{t.labels ? money(t.postage / t.labels) : "—"}</td><td className="num">{t.cancelled || ""}</td>
                    <td className="num">{money(t.cancelFees)}</td><td className="num">{money(t.adjustments)}</td><td className="num"><b>{money(t.total)}</b></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <details className="recon-days">
              <summary>{tr("按日明细（{n} 天有记录）", { n: activeDays.length })}</summary>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{tr("日期")}</th><th className="num">{tr("出单数")}</th><th className="num">{tr("邮费")}</th><th className="num">{tr("取消单")}</th><th className="num">{tr("取消费")}</th><th className="num">{tr("补差")}</th><th className="num">{tr("合计")}</th></tr></thead>
                  <tbody>
                    {[...activeDays].reverse().map((d) => (
                      <tr key={d.date}>
                        <td>{d.date}</td>
                        <td className="num">{d.labels}</td>
                        <td className="num">{money(d.postage)}</td>
                        <td className="num">{d.cancelled || ""}</td>
                        <td className="num">{d.cancelFees ? money(d.cancelFees) : ""}</td>
                        <td className="num">{d.adjCount ? money(d.adjustments) : ""}</td>
                        <td className="num"><b>{money(d.total)}</b></td>
                      </tr>
                    ))}
                    {!activeDays.length && <tr><td colSpan={7} className="muted">{tr("这个期间没有记录")}</td></tr>}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        );
      })}

      <p className="small muted">
        {tr("邮费有服务商实扣金额的用实扣，没有的用下单时的试算价。取消的单服务商会退回邮费，这里只算取消费。")}
      </p>
    </>
  );
}
