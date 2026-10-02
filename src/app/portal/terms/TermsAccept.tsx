"use client";

import { useState, useTransition } from "react";
import { acceptTermsAction, portalLogoutAction } from "../actions";
import { useT, useTMsg } from "@/components/I18n";

/** 签署：签署人姓名 + 职位（默认带出客户资料里的联系人），勾选同意 */
export default function TermsAccept({ contact, title }: { contact: string; title: string }) {
  const t = useT();
  const tm = useTMsg();
  const [agree, setAgree] = useState(false);
  const [signer, setSigner] = useState(contact);
  const [signerTitle, setSignerTitle] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const ready = agree && signer.trim() && signerTitle.trim();
  return (
    <div className="terms-accept">
      <div className="grid">
        <label className="f"><span className="req">{t("签署人姓名")}</span><input value={signer} maxLength={60} onChange={(e) => setSigner(e.target.value)} /></label>
        <label className="f"><span className="req">{t("签署人职位")}</span><input value={signerTitle} maxLength={60} onChange={(e) => setSignerTitle(e.target.value)} /></label>
      </div>
      <label className="terms-check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> {t("我已阅读并同意以上服务条款，保证如实申报货物信息，并同意重量尺寸复核后按承运商账单补差。")}
      </label>
      {error && <div className="alert err">{tm(error)}</div>}
      {!ready && (
        <p className="small muted" style={{ margin: "0 0 8px" }}>
          {t("还差：")}{[!signer.trim() && t("签署人姓名"), !signerTitle.trim() && t("签署人职位"), !agree && t("勾选同意")].filter(Boolean).join(t("、"))}
        </p>
      )}
      <div className="row">
        <button
          className="primary"
          disabled={!ready || busy}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await acceptTermsAction({ signer, signerTitle, agree });
              if (r?.error) setError(r.error);
            })
          }
        >
          {busy ? t("提交中…") : t("同意并签署")}
        </button>
        <form action={portalLogoutAction}><button type="submit">{t("不同意，退出登录")}</button></form>
      </div>
    </div>
  );
}
