import { getSettings } from "@/lib/db";
import { getLang, getT } from "@/lib/prefs";
import { getTerms, renderTerms } from "@/lib/terms";
import SiteNav from "../SiteNav";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${getSettings().brandName} · ${t("服务条款")}` };
}

/** 官网上公开的服务条款（客户名称处显示“客户”） */
export default async function SiteTermsPage() {
  const t = await getT();
  const lang = await getLang();
  const s = getSettings();
  const terms = getTerms();
  const text = renderTerms(lang === "en" ? terms.en : terms.zh, { customer: lang === "en" ? "the customer" : "客户", address: null, contact: null, title: null, phone: null, email: null });
  return (
    <div className="site">
      <SiteNav brand={s.brandName} home={false} />
      <div className="site-wrap" style={{ padding: "48px 32px 80px", maxWidth: 860 }}>
        <h1 style={{ fontSize: 34, margin: "0 0 8px" }}>{t("服务条款")}</h1>
        <p className="muted small" style={{ margin: "0 0 24px" }}>{t("第 {v} 版", { v: terms.version })}</p>
        <div className="terms-body print-full" style={{ background: "transparent", border: 0, padding: 0 }}>{text}</div>
      </div>
    </div>
  );
}
