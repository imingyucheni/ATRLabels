import { Check, Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { getSettings } from "@/lib/db";

/** 联系我们左侧：标题 + 联系方式（官网底部也用） */
export default function ContactIntro({ t, lang, site, compact = false }: { t: (k: string, v?: Record<string, string | number>) => string; lang: string; site: ReturnType<typeof getSettings>["site"]; compact?: boolean }) {
  return (
    <div>
      <p className="us-eyebrow">{t("联系我们")}</p>
      <h1 className={compact ? "h2" : ""}>{t("聊聊你的发货需求")}</h1>
      <p className="us-lead">{t("账户由我们为你开通。留下联系方式，我们会尽快联系你，确认渠道和价格。")}</p>
      <ul className="us-list">
        <li><Check size={16} /> {t("无月费、无最低单量")}</li>
        <li><Check size={16} /> {t("多家渠道自动比价")}</li>
        <li><Check size={16} /> {t("Zelle / 支付宝充值")}</li>
      </ul>
      <div className="us-contact-lines">
        {site.wechat && <div><MessageCircle size={16} /> {t("微信")} <b>{site.wechat}</b></div>}
        {site.phone && <div><Phone size={16} /> <b>{site.phone}</b></div>}
        {site.email && <div><Mail size={16} /> <a href={`mailto:${site.email}`}>{site.email}</a></div>}
        <div><MapPin size={16} /> {site.address || "Chino, CA 91710"}</div>
        {site.hours && <div><Clock size={16} /> {lang === "en" ? t(site.hours) : site.hours}</div>}
      </div>
    </div>
  );
}
