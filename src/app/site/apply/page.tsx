import { Check } from "lucide-react";
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
      <SiteNav brand={s.brandName} home={false} />
      <div className="site-wrap us-apply">
        <div>
          <p className="us-eyebrow">{t("开户免费")}</p>
          <h1>{t("开通账户，")}<br />{t("开始降低运费。")}</h1>
          <p className="us-lead">{t("留下联系方式，我们会尽快联系你，确认渠道和价格。")}</p>
          <ul className="us-list">
            <li><Check size={16} /> {t("无月费、无最低单量")}</li>
            <li><Check size={16} /> {t("多家渠道自动比价")}</li>
            <li><Check size={16} /> {t("Zelle / 支付宝充值")}</li>
          </ul>
          {(site.wechat || site.phone || site.email) && (
            <div className="us-local-card">
              {site.wechat && <div><span>{t("微信")} <b>{site.wechat}</b></span></div>}
              {site.phone && <div><span>{t("电话")} <b>{site.phone}</b></span></div>}
              {site.email && <div><span>{t("邮箱")} <a href={`mailto:${site.email}`}>{site.email}</a></span></div>}
              {site.hours && <div><span>{lang === "en" ? t(site.hours) : site.hours}</span></div>}
            </div>
          )}
        </div>
        <div className="site-apply-card">
          <ApplyForm volumes={VOLUME_OPTIONS} />
        </div>
      </div>
    </div>
  );
}
