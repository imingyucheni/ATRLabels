import { Check, MessageCircle } from "lucide-react";
import { getSettings } from "@/lib/db";
import { getLang, getT } from "@/lib/prefs";
import { VOLUME_OPTIONS } from "@/lib/leads";
import SiteNav from "../SiteNav";
import ApplyForm from "./ApplyForm";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${getSettings().brandName} · ${t("申请开户")}` };
}

export default async function ApplyPage() {
  const t = await getT();
  const lang = await getLang();
  const s = getSettings();
  const site = s.site;
  return (
    <div className="site">
      <div className="site-dark site-apply-page">
        <SiteNav brand={s.brandName} home={false} />
        <div className="site-glow" aria-hidden="true" />
        <div className="site-wrap site-apply">
          <div>
            <span className="site-eyebrow">{t("开户免费")}</span>
            <h1>{t("几分钟，")}<br /><span className="site-grad">{t("开始省运费")}</span></h1>
            <ul className="site-apply-points">
              <li><Check size={18} /> {t("无月费、无最低单量")}</li>
              <li><Check size={18} /> {t("多家渠道自动比价")}</li>
              <li><Check size={18} /> {t("Zelle / 支付宝充值")}</li>
            </ul>
            {(site.wechat || site.phone || site.email) && (
              <div className="site-apply-contact">
                <MessageCircle size={18} />
                <div>
                  <b>{t("想直接聊？")}</b>
                  {site.wechat && <div>{t("微信")} {site.wechat}</div>}
                  {site.phone && <div>{t("电话")} {site.phone}</div>}
                  {site.email && <div>{t("邮箱")} <a href={`mailto:${site.email}`}>{site.email}</a></div>}
                  {site.hours && <div>{lang === "en" ? t(site.hours) : site.hours}</div>}
                </div>
              </div>
            )}
          </div>
          <div className="site-apply-card">
            <ApplyForm volumes={VOLUME_OPTIONS} />
          </div>
        </div>
      </div>
    </div>
  );
}
