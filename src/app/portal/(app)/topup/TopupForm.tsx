"use client";

import { useActionState, useEffect, useRef, useState, startTransition } from "react";
import { portalTopupAction } from "@/app/portal/actions";

export default function TopupForm(props: {
  rate: number;
  rateNote: string;
  zelleInfo: string;
  alipayInfo: string;
  alipayQr: boolean;
}) {
  const [method, setMethod] = useState<"zelle" | "alipay">(props.zelleInfo || !props.alipayInfo ? "zelle" : "alipay");
  const [amount, setAmount] = useState("");
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
        startTransition(() => action(fd));
      }}
    >
      <h2>提交充值</h2>
      {state?.ok && <div className="alert ok">{state.ok}</div>}
      {state?.error && <div className="alert err">{state.error}</div>}
      <div className="row" style={{ marginBottom: 12 }}>
        <button type="button" className={method === "zelle" ? "primary" : ""} onClick={() => setMethod("zelle")}>Zelle（美元）</button>
        <button type="button" className={method === "alipay" ? "primary" : ""} onClick={() => setMethod("alipay")}>支付宝（人民币）</button>
      </div>

      <div className="grid2">
        <div>
          <label className="f" style={{ marginBottom: 10 }}>
            <span className="req">充值金额（美元）</span>
            <input name="amountUsd" type="number" min="1" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="例如 200" />
          </label>
          {method === "alipay" ? (
            <div className="alert warn">
              当前汇率 <b>{props.rate}</b>（{props.rateNote}）<br />
              充值 {usd ? `$${usd.toFixed(2)}` : "…"} 需支付 <b style={{ fontSize: 18 }}>¥{usd ? cny.toFixed(2) : "—"}</b>
              <div className="small">汇率随实时汇率变动，以提交时的金额为准。</div>
            </div>
          ) : (
            <div className="alert warn">请通过 Zelle 转账 <b>{usd ? `$${usd.toFixed(2)}` : "…"}</b>，到账后按美元金额加到余额。</div>
          )}
          <label className="f" style={{ marginBottom: 10 }}>
            {method === "zelle" ? "Zelle 转账参考号 / 付款人姓名" : "支付宝订单号 / 付款人姓名"}
            <input name="reference" maxLength={100} />
          </label>
          <label className="f" style={{ marginBottom: 10 }}>付款截图（建议上传，PNG / JPG / PDF，5MB 以内）<input name="proof" type="file" accept=".png,.jpg,.jpeg,.pdf" /></label>
          <label className="f" style={{ marginBottom: 12 }}>备注<input name="note" maxLength={300} /></label>
          <button className="primary" disabled={pending}>{pending ? "提交中…" : "我已付款，提交充值申请"}</button>
        </div>
        <div>
          <div className="small muted" style={{ marginBottom: 4 }}>收款信息</div>
          <div className="card" style={{ background: "var(--bg)", whiteSpace: "pre-wrap" }}>
            {method === "zelle" ? props.zelleInfo || "请联系客服获取 Zelle 收款信息" : props.alipayInfo || "请联系客服获取支付宝收款信息"}
            {method === "alipay" && props.alipayQr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/api/assets/alipay-qr" alt="支付宝收款码" style={{ display: "block", width: 200, maxWidth: "100%", marginTop: 12, border: "1px solid var(--line)", borderRadius: 8 }} />
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
