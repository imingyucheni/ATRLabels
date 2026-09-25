"use client";

import { useActionState, useEffect, useRef, useState, startTransition } from "react";
import { portalTopupAction } from "@/app/portal/actions";
import FilePick from "@/components/FilePick";
import { useT, useTMsg } from "@/components/I18n";
import { Eye, EyeOff } from "lucide-react";

export default function TopupForm(props: {
  rate: number;
  rateNote: string;
  zelleInfo: string;
  alipayInfo: string;
  alipayQr: boolean;
  /** 后台设置的充值说明（显示在收款信息下面） */
  instructions?: string;
}) {
  const t = useT();
  const tMsg = useTMsg();
  const [method, setMethod] = useState<"zelle" | "alipay">(props.zelleInfo || !props.alipayInfo ? "zelle" : "alipay");
  const [amount, setAmount] = useState("");
  // 收款账号默认隐藏，点按钮才显示
  const [showPay, setShowPay] = useState(false);
  const [state, action, pending] = useActionState(portalTopupAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      ref.current?.reset();
      setAmount("");
    }
  }, [state]);

  const usd = Number(amount) || 0;
  const cny = Math.ceil(Math.round(usd * props.rate * 1e6) / 1e4) / 100;

  return (
    <form
      ref={ref}
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("method", method);
        fd.set("quotedRate", String(props.rate));
        startTransition(() => action(fd));
      }}
    >
      <h2>{t("提交充值")}</h2>
      {state?.ok && <div className="alert ok">{tMsg(state.ok)}</div>}
      {state?.error && <div className="alert err">{tMsg(state.error)}</div>}
      <div className="row" style={{ marginBottom: 12 }}>
        <button type="button" className={method === "zelle" ? "primary" : ""} onClick={() => setMethod("zelle")}>{t("Zelle（美元）")}</button>
        <button type="button" className={method === "alipay" ? "primary" : ""} onClick={() => setMethod("alipay")}>{t("支付宝（人民币）")}</button>
      </div>

      <div className="grid2">
        <div>
          <label className="f" style={{ marginBottom: 10 }}>
            <span className="req">{t("充值金额（美元）")}</span>
            <input name="amountUsd" type="number" min="1" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t("例如 200")} />
          </label>
          {method === "alipay" ? (
            <div className="alert warn">
              {t("当前汇率")} <b>{props.rate}</b>{t("（{note}）", { note: props.rateNote })}<br />
              {usd ? (
                <>{t("充值 {usd} 需支付", { usd: `$${usd.toFixed(2)}` })} <b style={{ fontSize: 18 }}>¥{cny.toFixed(2)}</b></>
              ) : (
                <>{t("填写充值金额后显示需要支付的人民币金额")}</>
              )}
              <div className="small">{t("请按这里显示的金额付款，付款后提交申请即按这个汇率入账。汇率当天有效，隔天付款请先刷新页面。")}</div>
            </div>
          ) : (
            <div className="alert warn">{usd ? <>{t("请通过 Zelle 转账")} <b>${usd.toFixed(2)}</b>{t("，到账后按美元金额加到余额。")}</> : t("填写充值金额后，通过 Zelle 转账相同的美元金额。")}</div>
          )}
          <label className="f" style={{ marginBottom: 10 }}>
            {t(method === "zelle" ? "Zelle 转账参考号 / 付款人姓名" : "支付宝订单号 / 付款人姓名")}
            <input name="reference" maxLength={100} />
          </label>
          <label className="f" style={{ marginBottom: 10 }}>{t("付款截图（建议上传，PNG / JPG / PDF，5MB 以内）")}<FilePick name="proof" accept=".png,.jpg,.jpeg,.pdf" /></label>
          <label className="f" style={{ marginBottom: 12 }}>{t("备注")}<input name="note" maxLength={300} /></label>
          <button className="primary" disabled={pending}>{t(pending ? "提交中…" : "我已付款，提交充值申请")}</button>
        </div>
        <div>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <b>{t(method === "zelle" ? "Zelle 收款信息" : "支付宝收款信息")}</b>
            <button type="button" className="accent-outline" aria-expanded={showPay} onClick={() => setShowPay((v) => !v)}>
              {showPay ? <EyeOff size={15} strokeWidth={2} /> : <Eye size={15} strokeWidth={2} />}
              {t(showPay ? "隐藏收款信息" : "显示收款信息")}
            </button>
          </div>
          {showPay ? (
            <div className="card" style={{ background: "var(--bg)", whiteSpace: "pre-wrap" }}>
              {method === "zelle" ? props.zelleInfo || t("请联系客服获取 Zelle 收款信息") : props.alipayInfo || t("请联系客服获取支付宝收款信息")}
              {method === "alipay" && props.alipayQr && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/api/assets/alipay-qr" alt={t("支付宝收款码")} style={{ display: "block", width: 200, maxWidth: "100%", marginTop: 12, border: "1px solid var(--line)", borderRadius: 8 }} />
              )}
            </div>
          ) : (
            <div className="pay-hidden" onClick={() => setShowPay(true)}>
              {t("收款账号已隐藏，点击“显示收款信息”查看")}
            </div>
          )}
          {props.instructions && <p className="small muted" style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{props.instructions}</p>}
        </div>
      </div>
    </form>
  );
}
