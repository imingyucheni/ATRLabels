import Link from "next/link";
import { ArrowRight, Headset, Receipt, Wallet } from "lucide-react";
import { getSettings } from "@/lib/db";
import { getLang, getT } from "@/lib/prefs";
import { CARRIERS } from "@/lib/carriers";
import { VOLUME_OPTIONS } from "@/lib/leads";
import SiteNav from "./SiteNav";
import RateCalculator from "./RateCalculator";
import ProductTabs from "./ProductTabs";
import CoverageMap from "./CoverageMap";
import ContactForm from "./ContactForm";
import ContactIntro from "./ContactIntro";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  const { brandName } = getSettings();
  return {
    title: `${brandName} · ${t("美西本地尾程面单")}`,
    description: t("一个账户比遍 USPS、UniUni、GOFO、SpeedX、FedEx 等渠道，预付余额、无月费，Excel 批量出单，洛杉矶本地团队中文服务。"),
  };
}

/** 官网首页：美式 B2B 风格，互动试算 + 产品轮播 + 覆盖地图 + 联系表单（不开放自助注册） */
export default async function SitePage() {
  const t = await getT();
  const lang = await getLang();
  const s = getSettings();
  const brand = s.brandName;
  const site = s.site;
  const hours = Number(s.cancelWindowHours ?? 48);
  const logos = ["usps", "uniuni", "gofo", "speedx", "swiftx", "fedex"].map((id) => CARRIERS.find((c) => c.id === id)!);

  const faq: [string, string][] = [
    [t("怎么开通账户？"), t("填写联系表单或直接联系我们，确认渠道和价格后由我们为你开通。")],
    [t("有月费或最低单量吗？"), t("没有。按单扣费，没有月费和最低单量。")],
    [t("怎么充值？"), t("Zelle 或支付宝，提交付款参考号，确认后到账。")],
    [t("可以取消面单吗？"), hours > 0 ? t("下单后 {h} 小时内可以取消；未出面单全额退回。", { h: hours }) : t("可以申请取消；未出面单全额退回。")],
    [t("会有补差吗？"), t("承运商复核重量尺寸后可能补差，逐单列明，同一单不重复扣。")],
  ];

  return (
    <div className="site">
      <SiteNav brand={brand} />

      {/* ---------- Hero ---------- */}
      <header className="us-hero lux">
        <div className="lux-bg" aria-hidden="true" />
        <div className="site-wrap us-hero-grid">
          <div>
            <p className="us-eyebrow">{t("美西尾程 · 洛杉矶")}</p>
            <h1><span className="l">{t("每个渠道，")}</span><span className="l">{t("一个账户，")}</span><span className="l accent">{t("最低运费。")}</span></h1>
            <p className="us-lead">{t("实时比较 USPS、UniUni、GOFO、FedEx 等渠道报价，自动选出最低价。预付余额，无月费。")}</p>
            <div className="us-cta">
              <Link href="#contact" className="btn us-btn lg">{t("联系我们")}</Link>
              <Link href="/portal" className="us-link">{t("客户登录")} <ArrowRight size={16} /></Link>
            </div>
            <p className="us-fine">{t("无月费")} · {t("无最低单量")}{hours > 0 ? ` · ${t("{h} 小时内可取消", { h: hours })}` : ""}</p>
          </div>
          <RateCalculator />
        </div>

        <div className="site-wrap us-logos">
          <span>{t("支持的尾程渠道")}</span>
          <div>
            {logos.map((c) => (
              <span key={c.id} className="carrier-mark md mono">
                {c.logo ? <img src={c.logo} alt={c.name} /> : <span className="carrier-text">{c.name}</span>}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* ---------- Metrics ---------- */}
      <section className="us-metrics">
        <div className="site-wrap">
          <div><b>$0</b><span>{t("月费")}</span></div>
          <div><b>6+</b><span>{t("尾程渠道")}</span></div>
          {hours > 0 && <div><b>{hours}h</b><span>{t("可取消时限")}</span></div>}
          <div><b>1</b><span>{t("个账户管理所有渠道")}</span></div>
        </div>
      </section>

      {/* ---------- 产品轮播 ---------- */}
      <section className="us-section" id="product">
        <div className="site-wrap">
          <div className="us-head">
            <p className="us-eyebrow">{t("产品")}</p>
            <h2>{t("一个平台，搞定尾程发货")}</h2>
          </div>
          <ProductTabs />
        </div>
      </section>

      {/* ---------- 覆盖地图 ---------- */}
      <section className="us-map-band" id="coverage">
        <div className="site-wrap us-map-grid">
          <div>
            <p className="us-eyebrow light">{t("覆盖范围")}</p>
            <h2>{t("从洛杉矶，发往全美")}</h2>
            <p className="us-sub light">{t("仓库在 Chino, CA，覆盖美国本土 48 州。西海岸时效更快，运费更低。")}</p>
            <div className="us-map-stats">
              <div><b>48</b><span>{t("本土州")}</span></div>
              <div><b>Zone 1–8</b><span>{t("全分区报价")}</span></div>
            </div>
          </div>
          <CoverageMap />
        </div>
      </section>

      {/* ---------- 为什么选我们 ---------- */}
      <section className="us-section" id="why">
        <div className="site-wrap">
          <div className="us-head">
            <p className="us-eyebrow">{t("为什么选我们")}</p>
            <h2>{t("为专业卖家打造")}</h2>
          </div>
          <div className="lux-cards">
            <article>
              <Headset size={22} strokeWidth={1.6} />
              <h3>{t("本地团队")}</h3>
              <p>{t("就在洛杉矶，中英文沟通，工作时间快速响应。")}</p>
            </article>
            <article>
              <Receipt size={22} strokeWidth={1.6} />
              <h3>{t("透明计费")}</h3>
              <p>{t("下单前看到最终价格；补差逐单列明，不重复扣。")}</p>
            </article>
            <article>
              <Wallet size={22} strokeWidth={1.6} />
              <h3>{t("没有月费")}</h3>
              <p>{t("预付余额，按单扣费；Zelle、支付宝充值。")}</p>
            </article>
          </div>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="us-section alt" id="faq">
        <div className="site-wrap us-faq">
          <div>
            <p className="us-eyebrow">FAQ</p>
            <h2>{t("常见问题")}</h2>
          </div>
          <div className="lux-faq">
            {faq.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 联系我们 ---------- */}
      <section className="us-section" id="contact">
        <div className="site-wrap us-apply embed">
          <ContactIntro t={t} lang={lang} site={site} compact />
          <div className="site-apply-card"><ContactForm volumes={VOLUME_OPTIONS} /></div>
        </div>
      </section>

      <footer className="us-footer">
        <div className="site-wrap us-footer-grid">
          <div>
            <b className="us-footer-brand">{brand}</b>
            <p>{t("美西本地尾程面单")}</p>
          </div>
          <div>
            <h4>{t("产品")}</h4>
            <a href="#product">{t("实时比价")}</a>
            <a href="#coverage">{t("覆盖范围")}</a>
            <a href="#faq">{t("常见问题")}</a>
          </div>
          <div>
            <h4>{t("账户")}</h4>
            <a href="#contact">{t("联系我们")}</a>
            <Link href="/portal">{t("客户登录")}</Link>
          </div>
          <div>
            <h4>{t("公司")}</h4>
            <span>{site.company}</span>
            <span>{site.address || "Chino, CA 91710"}</span>
          </div>
        </div>
        <div className="site-wrap us-footer-bottom">© {new Date().getFullYear()} {site.company || brand}</div>
      </footer>
    </div>
  );
}
