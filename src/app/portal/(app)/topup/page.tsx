import { requireCustomer } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { usdCnyQuote } from "@/lib/fx";
import { money } from "@/lib/pricing";
import { listTopups, TOPUP_METHOD_LABEL, TOPUP_STATUS_LABEL } from "@/lib/topup";
import TopupForm from "./TopupForm";

export default async function PortalTopup() {
  const me = await requireCustomer();
  const s = getSettings();
  const fx = await usdCnyQuote();
  const list = listTopups({ customerId: me.id, limit: 50 });
  const available = me.balance + me.creditLimit;
  return (
    <>
      <h1>充值</h1>
      {available <= 0 && <div className="alert err">账户余额不足（{money(me.balance)}），需要充值后才能继续下单。</div>}
      <div className="stats">
        <div className="stat"><div className="muted">当前余额（美元）</div><div className={`v ${me.balance < 0 ? "profit-neg" : ""}`}>{money(me.balance)}</div></div>
        {me.creditLimit > 0 && <div className="stat"><div className="muted">可用额度（含信用额度）</div><div className="v">{money(available)}</div></div>}
        <div className="stat"><div className="muted">今日人民币汇率</div><div className="v">{fx.rate}</div><div className="small muted">充 $100 需付 ¥{(Math.ceil(Math.round(100 * fx.rate * 1e6) / 1e4) / 100).toFixed(2)}</div></div>
      </div>
      <TopupForm rate={fx.rate} rateNote={fx.manual ? "固定汇率" : "当天实时汇率 + 换汇费"} zelleInfo={s.zelleInfo} alipayInfo={s.alipayInfo} alipayQr={s.alipayQr} />
      {s.topupInstructions && <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{s.topupInstructions}</p>}

      <div className="card table-wrap">
        <h2>充值记录</h2>
        <table>
          <thead><tr><th>#</th><th>提交时间</th><th>方式</th><th className="num">充值（美元）</th><th className="num">支付金额</th><th>状态</th><th className="num">到账（美元）</th><th>说明</th></tr></thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id}>
                <td className="muted">{t.id}</td>
                <td className="small muted">{t.createdAt}</td>
                <td>{TOPUP_METHOD_LABEL[t.method]}</td>
                <td className="num">{money(t.amountUsd)}</td>
                <td className="num">{t.payCurrency === "CNY" ? `¥${t.payAmount.toFixed(2)}` : `$${t.payAmount.toFixed(2)}`}{t.fxRate && <div className="small muted">汇率 {t.fxRate}</div>}</td>
                <td><span className={`badge ${t.status === "approved" ? "labeled" : t.status === "pending" ? "pending" : "exception"}`}>{TOPUP_STATUS_LABEL[t.status]}</span></td>
                <td className="num">{t.creditedUsd !== null ? money(t.creditedUsd) : "-"}</td>
                <td className="small">{t.adminNote}{t.hasProof && <> <a href={`/api/topup/${t.id}/proof`} target="_blank">凭证</a></>}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={8} className="muted">还没有充值记录</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
