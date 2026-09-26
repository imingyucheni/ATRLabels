import { Check, Clock, MessageCircle } from "lucide-react";
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
      <section className="site-section">
        <div className="site-wrap site-apply">
          <div>
            <span className="site-kicker">{t("申请开户")}</span>
            <h1>{t("开户免费，几分钟就好")}</h1>
            <p className="site-lead">{t("留下联系方式，我们会尽快联系你，确认你常用的渠道和价格，开通账户后就能充值下单。")}</p>
            <ul className="site-apply-points">
              <li><Check size={16} /> {t("无月费、无最低单量、无开户费")}</li>
              <li><Check size={16} /> {t("多家渠道一起比价，自动挑最便宜的")}</li>
              <li><Check size={16} /> {t("Zelle / 支付宝充值，按单扣费")}</li>
            </ul>
            {(site.wechat || site.phone || site.email) && (
              <div className="site-apply-contact card">
                <MessageCircle size={18} />
                <div>
                  <b>{t("想直接聊？")}</b>
                  {site.wechat && <div>{t("微信")}：{site.wechat}</div>}
                  {site.phone && <div>{t("电话")}：{site.phone}</div>}
                  {site.email && <div>{t("邮箱")}：<a href={`mailto:${site.email}`}>{site.email}</a></div>}
                  {site.hours && <div className="small muted"><Clock size={12} /> {lang === "en" ? t(site.hours) : site.hours}</div>}
                </div>
              </div>
            )}
          </div>
          <div className="card site-apply-card">
            <ApplyForm volumes={VOLUME_OPTIONS} />
          </div>
        </div>
      </section>
    </div>
  );
}
