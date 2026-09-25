import { fmtTime } from "@/lib/time";
import { requireCustomer } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { usdCnyQuote } from "@/lib/fx";
import { money, usd } from "@/lib/pricing";
import { listTopups, TOPUP_METHOD_LABEL, TOPUP_STATUS_LABEL } from "@/lib/topup";
import TopupForm from "./TopupForm";
import { getT } from "@/lib/prefs";

export default async function PortalTopup() {
  const me = await requireCustomer();
  const tr = await getT();
  const s = getSettings();
  const fx = await usdCnyQuote();
  const list = listTopups({ customerId: me.id, limit: 50 });
  const available = me.balance + me.creditLimit;
  return (
    <>
      <h1>{tr("充值")}</h1>
      {available <= 0 && <div className="alert err">{tr("账户余额不足（{balance}），需要充值后才能继续下单。", { balance: usd(me.balance) })}</div>}
      <div className="stats">
        <div className="stat"><div className="muted">{tr("当前余额（美元）")}</div><div className={`v ${me.balance < 0 ? "profit-neg" : ""}`}>{usd(me.balance)}</div></div>
        {me.creditLimit > 0 && <div className="stat"><div className="muted">{tr("可用额度（含信用额度）")}</div><div className="v">{usd(available)}</div></div>}
      </div>
      <TopupForm rate={fx.rate} rateNote={tr(fx.manual ? "固定汇率" : "今日汇率，每天更新")} zelleInfo={s.zelleInfo} alipayInfo={s.alipayInfo} alipayQr={s.alipayQr} />
      {s.topupInstructions && <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{s.topupInstructions}</p>}

      <div className="card table-wrap">
        <h2>{tr("充值记录")}</h2>
        <table>
          <thead><tr><th>#</th><th>{tr("提交时间")}</th><th>{tr("方式")}</th><th className="num">{tr("充值（美元）")}</th><th className="num">{tr("支付金额")}</th><th>{tr("状态")}</th><th className="num">{tr("到账（美元）")}</th><th>{tr("说明")}</th></tr></thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id}>
                <td className="muted">{t.id}</td>
                <td className="small muted">{fmtTime(t.createdAt)}</td>
                <td>{tr(TOPUP_METHOD_LABEL[t.method])}</td>
                <td className="num">{money(t.amountUsd)}</td>
                <td className="num">{t.payCurrency === "CNY" ? `¥${t.payAmount.toFixed(2)}` : `$${t.payAmount.toFixed(2)}`}{t.fxRate && <div className="small muted">{tr("汇率 {rate}", { rate: t.fxRate })}</div>}</td>
                <td><span className={`badge ${t.status === "approved" ? "labeled" : t.status === "pending" ? "pending" : "exception"}`}>{tr(TOPUP_STATUS_LABEL[t.status])}</span></td>
                <td className="num">{t.creditedUsd !== null ? money(t.creditedUsd) : "-"}</td>
                <td className="small">{t.adminNote}{t.hasProof && <> <a href={`/api/topup/${t.id}/proof`} target="_blank">{tr("凭证")}</a></>}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={8} className="muted">{tr("还没有充值记录")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
