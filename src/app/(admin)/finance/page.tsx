import { fmtTime } from "@/lib/time";
import Link from "next/link";
import { listCustomers } from "@/lib/db";
import { LEDGER_TYPE_LABEL, listLedger } from "@/lib/ledger";
import { money } from "@/lib/pricing";
import { listTopups, TOPUP_METHOD_LABEL, TOPUP_STATUS_LABEL } from "@/lib/topup";
import FlashForm from "@/components/FlashForm";
import { approveTopupAction, rejectTopupAction } from "@/app/actions";
import { getLang } from "@/lib/prefs";
import { makeT, translateMessage } from "@/lib/i18n";

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const lang = await getLang();
  const tr = makeT(lang);
  const note = (s: string | null) => (s ? s.split(" · ").map((x) => translateMessage(lang, x)).join(" · ") : s);
  const customers = listCustomers();
  const ledger = listLedger({ from: sp.from, to: sp.to, limit: 300 });
  const prepaid = customers.reduce((a, c) => a + Math.max(0, c.balance), 0);
  const owed = customers.reduce((a, c) => a + Math.min(0, c.balance), 0);
  const byType = ledger.reduce<Record<string, number>>((m, l) => ((m[l.type] = (m[l.type] ?? 0) + l.amount), m), {});
  const pending = listTopups({ status: "pending" });
  const handled = listTopups({ limit: 30 }).filter((t) => t.status !== "pending");
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <h1>{tr("财务")}</h1>
      <div className="stats">
        <div className="stat"><div className="muted">{tr("客户预存余额合计")}</div><div className="v">{money(prepaid)}</div></div>
        <div className="stat"><div className="muted">{tr("客户欠款合计")}</div><div className={`v ${owed < 0 ? "profit-neg" : ""}`}>{money(-owed)}</div></div>
        <div className="stat"><div className="muted">{tr("客户数")}</div><div className="v">{customers.length}</div></div>
      </div>

      <div className="card table-wrap" id="topups">
        <h2>{tr("待确认充值（{n}）", { n: pending.length })}</h2>
        {!pending.length && <p className="muted">{tr("没有待确认的充值申请")}</p>}
        {pending.length > 0 && (
          <table>
            <thead><tr><th>#</th><th>{tr("客户")}</th><th>{tr("方式")}</th><th className="num">{tr("申请（美元）")}</th><th className="num">{tr("应收")}</th><th>{tr("参考号 / 备注")}</th><th>{tr("凭证")}</th><th>{tr("处理")}</th></tr></thead>
            <tbody>
              {pending.map((t) => (
                <tr key={t.id}>
                  <td className="muted">{t.id}<div className="small">{fmtTime(t.createdAt)}</div></td>
                  <td><Link href={`/customers/${t.customerId}`}>{t.customerName}</Link></td>
                  <td>{tr(TOPUP_METHOD_LABEL[t.method])}</td>
                  <td className="num">{money(t.amountUsd)}</td>
                  <td className="num"><b>{t.payCurrency === "CNY" ? `¥${t.payAmount.toFixed(2)}` : `$${t.payAmount.toFixed(2)}`}</b>{t.fxRate && <div className="small muted">{tr("实时 {live} + 加点 {markup} = {rate}", { live: t.fxLive, markup: t.fxLive ? (t.fxRate - t.fxLive).toFixed(4).replace(/0+$/, "") : "-", rate: t.fxRate })}</div>}</td>
                  <td className="small">{t.reference}{t.note && <div className="muted">{t.note}</div>}</td>
                  <td>{t.hasProof ? <a href={`/api/topup/${t.id}/proof`} target="_blank">{tr("查看")}</a> : <span className="muted small">{tr("无")}</span>}</td>
                  <td style={{ minWidth: 300 }}>
                    <div className="review-box">
                      <FlashForm action={approveTopupAction} submitLabel="确认到账" submitClass="primary small" confirm="确认已收到这笔款项并入账？">
                        <input type="hidden" name="id" value={t.id} />
                        <div className="row" style={{ gap: 6, marginBottom: 6 }}>
                          <label className="f" style={{ width: 110 }}>{tr("入账美元")}<input name="creditedUsd" type="number" step="0.01" min="0.01" defaultValue={t.amountUsd} /></label>
                          <label className="f" style={{ flex: 1 }}>{tr("入账备注（写进流水）")}<input name="adminNote" maxLength={200} /></label>
                        </div>
                      </FlashForm>
                    </div>
                    <div className="review-box reject">
                      <FlashForm action={rejectTopupAction} submitLabel="不通过" submitClass="danger small" confirm="确认不通过这笔充值申请？客户会看到原因。">
                        <input type="hidden" name="id" value={t.id} />
                        <label className="f" style={{ marginBottom: 6 }}>{tr("不通过原因（客户可见）")}<input name="adminNote" maxLength={200} required /></label>
                      </FlashForm>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {handled.length > 0 && (
          <>
            <h3>{tr("最近处理")}</h3>
            <table>
              <thead><tr><th>#</th><th>{tr("处理时间")}</th><th>{tr("客户")}</th><th>{tr("方式")}</th><th className="num">{tr("应收")}</th><th>{tr("状态")}</th><th className="num">{tr("入账（美元）")}</th><th>{tr("备注")}</th></tr></thead>
              <tbody>
                {handled.map((t) => (
                  <tr key={t.id}>
                    <td className="muted">{t.id}</td>
                    <td className="small muted">{fmtTime(t.handledAt)}</td>
                    <td>{t.customerName}</td>
                    <td className="small">{tr(TOPUP_METHOD_LABEL[t.method])}</td>
                    <td className="num">{t.payCurrency === "CNY" ? `¥${t.payAmount.toFixed(2)}` : `$${t.payAmount.toFixed(2)}`}</td>
                    <td>{tr(TOPUP_STATUS_LABEL[t.status])}</td>
                    <td className="num">{t.creditedUsd !== null ? money(t.creditedUsd) : "-"}</td>
                    <td className="small">{t.adminNote}{t.hasProof && <> <a href={`/api/topup/${t.id}/proof`} target="_blank">{tr("凭证")}</a></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="card table-wrap">
        <h2>{tr("客户余额")}</h2>
        <table>
          <thead><tr><th>{tr("客户")}</th><th className="num">{tr("余额")}</th><th className="num">{tr("信用额度")}</th><th className="num">{tr("可用")}</th><th></th></tr></thead>
          <tbody>
            {[...customers].sort((a, b) => a.balance - b.balance).map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className={`num ${c.balance < 0 ? "profit-neg" : ""}`}>{money(c.balance)}</td>
                <td className="num">{money(c.creditLimit)}</td>
                <td className={`num ${c.balance + c.creditLimit <= 0 ? "profit-neg" : ""}`}>{money(c.balance + c.creditLimit)}</td>
                <td><Link href={`/customers/${c.id}`}>{tr("充值 / 流水")}</Link> · <Link href={`/customers/${c.id}/statement`}>{tr("对账单")}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="card row" method="get">
        <label className="f">{tr("开始日期")}<input type="date" name="from" defaultValue={sp.from} /></label>
        <label className="f">{tr("结束日期")}<input type="date" name="to" defaultValue={sp.to} /></label>
        <button className="primary">{tr("筛选流水")}</button>
        <a className="btn" href={`/api/ledger?${qs}`}>{tr("导出流水 CSV")}</a>
      </form>
      <div className="stats">
        {Object.entries(byType).map(([t, v]) => (
          <div className="stat" key={t}><div className="muted">{tr(LEDGER_TYPE_LABEL[t as keyof typeof LEDGER_TYPE_LABEL] ?? t)}</div><div className="v">{money(v)}</div></div>
        ))}
      </div>
      <div className="card table-wrap">
        <h2>{tr("全部流水（最近 300 条）")}</h2>
        <table>
          <thead><tr><th>{tr("时间")}</th><th>{tr("客户")}</th><th>{tr("类型")}</th><th>{tr("单号")}</th><th>{tr("说明")}</th><th className="num">{tr("金额")}</th></tr></thead>
          <tbody>
            {ledger.map((l) => (
              <tr key={l.id}>
                <td className="small muted">{fmtTime(l.createdAt)}</td>
                <td><Link href={`/customers/${l.customerId}`}>{l.customerName}</Link></td>
                <td>{tr(LEDGER_TYPE_LABEL[l.type])}</td>
                <td>{l.shipmentId ? <Link href={`/shipments/${l.shipmentId}`}>{l.customNo}</Link> : "-"}</td>
                <td className="small">{note(l.note)}</td>
                <td className={`num ${l.amount >= 0 ? "profit-pos" : ""}`}>{money(l.amount)}</td>
              </tr>
            ))}
            {!ledger.length && <tr><td colSpan={6} className="muted">{tr("没有流水")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
