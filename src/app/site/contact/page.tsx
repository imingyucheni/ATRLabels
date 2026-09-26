import { getSettings } from "@/lib/db";
import { getLang, getT } from "@/lib/prefs";
import { VOLUME_OPTIONS } from "@/lib/leads";
import SiteNav from "../SiteNav";
import ContactForm from "../ContactForm";
import ContactIntro from "../ContactIntro";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${getSettings().brandName} · ${t("联系我们")}` };
}

export default async function ContactPage() {
  const t = await getT();
  const lang = await getLang();
  const s = getSettings();
  const site = s.site;
  return (
    <div className="site">
      <SiteNav brand={s.brandName} home={false} />
      <div className="site-wrap us-apply">
        <ContactIntro t={t} lang={lang} site={site} />
        <div className="site-apply-card"><ContactForm volumes={VOLUME_OPTIONS} /></div>
      </div>
    </div>
  );
}
