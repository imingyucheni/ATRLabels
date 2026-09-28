import { redirect } from "next/navigation";
import { currentCustomerId, impersonatedCustomerId } from "@/lib/auth";
import { getCustomer, getSettings } from "@/lib/db";
import { getTerms, hasAcceptedTerms, lastAcceptance, partyOf, renderTerms } from "@/lib/terms";
import { fmtTime } from "@/lib/time";
import { getLang, getT } from "@/lib/prefs";
import PrefToggles from "@/components/PrefToggles";
import TermsAccept from "./TermsAccept";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("服务条款")} · ${getSettings().brandName}` };
}

/** 客户第一次登录（或条款更新后）必须同意服务条款才能继续使用 */
export default async function PortalTermsPage() {
  const id = await currentCustomerId();
  if (!id) redirect("/portal/login");
  const acting = !!(await impersonatedCustomerId());
  const accepted = hasAcceptedTerms(id);
  const t = await getT();
  const lang = await getLang();
  const terms = getTerms();
  const c = getCustomer(id)!;
  const party = partyOf(c);
  const signed = accepted ? lastAcceptance(id) : null;
  // 已签署的显示签署时存档的原文
  const text = signed?.text ?? renderTerms(lang === "en" ? terms.en : terms.zh, party);
  return (
    <div className="terms-page">
      <div className="terms-card">
        <div className="terms-head">
          <div>
            <h1>{t("服务条款")}</h1>
            <p className="small muted">{getSettings().brandName} · {c.name}{terms.version > 1 ? ` · ${t("第 {v} 版", { v: terms.version })}` : ""}</p>
          </div>
          <PrefToggles />
        </div>
        {!accepted && !acting && terms.version > 1 && lastAcceptance(id) && (
          <div className="alert warn">
            {t("服务条款已更新，请阅读并同意新的条款后继续使用。")}
            {terms.changeNote && <div style={{ marginTop: 4 }}><b>{t("本次修改")}</b>{t("：")}{terms.changeNote}</div>}
          </div>
        )}
        <div className="terms-body" tabIndex={0}>{text}</div>
        {signed && <p className="small muted">{t("签署")}{t("：")}{signed.signer}{signed.signerTitle ? ` · ${signed.signerTitle}` : ""} · {fmtTime(signed.acceptedAt)}</p>}
        {!accepted && <p className="small muted" style={{ marginBottom: 0 }}>{t("条款中的客户信息如有错误，请联系客服修改后再签署。")}</p>}
        {accepted ? (
          <p className="small muted">{t("您已同意这份条款。")} <a href="/portal">{t("返回客户中心")}</a></p>
        ) : acting ? (
          <p className="small muted">{t("管理员代操作时不能替客户同意条款，客户下次登录时会看到这份条款。")} <a href="/portal">{t("返回客户中心")}</a></p>
        ) : (
          <TermsAccept contact={c.contact ?? ""} title={c.contactTitle ?? ""} />
        )}
      </div>
    </div>
  );
}
