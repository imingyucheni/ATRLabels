import Link from "next/link";
import { ArrowRight, BellRing, Calculator, Check, CircleHelp, DatabaseBackup, Headset, LogIn, Map, MapPinned, MessageSquare, PackageCheck, Receipt, Tag, UserCheck, Wallet } from "lucide-react";
import { getSettings } from "@/lib/db";
import { getLang, getT } from "@/lib/prefs";
import { CARRIERS } from "@/lib/carriers";
import { VOLUME_OPTIONS } from "@/lib/leads";
import SiteNav from "./SiteNav";
import RateCalculator from "./RateCalculator";
import ProductTabs from "./ProductTabs";
import WhoTabs from "./WhoTabs";
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
  const logos = ["usps", "uniuni", "gofo", "speedx", "swiftx", "fedex", "ontrac"].map((id) => CARRIERS.find((c) => c.id === id)!);

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
      <header className="us-hero lux" id="top">
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
            <ul className="hero-ticks">
              <li><Check size={16} /> {t("无月费、无最低单量")}</li>
              <li><Check size={16} /> {t("下单前看到最终价格")}</li>
              {hours > 0 && <li><Check size={16} /> {t("{h} 小时内可取消", { h: hours })}</li>}
            </ul>
          </div>
          <RateCalculator />
        </div>

        <div className="site-wrap us-logos">
          <span>{t("支持的尾程渠道")}</span>
          {/* 横向循环滚动：同一组 logo 放两遍，滚到一半无缝接上；第二组只是视觉重复，读屏跳过 */}
          <div className="logo-marquee">
            <div className="logo-track">
              {[0, 1].map((dup) =>
                logos.map((c) => (
                  <span key={`${dup}-${c.id}`} className="carrier-mark md mono" aria-hidden={dup === 1 || undefined}>
                    {c.logo ? <img src={c.logo} alt={dup ? "" : c.name} /> : c.id === "fedex" ? <span className="carrier-text fedex"><b>Fed</b><i>Ex</i></span> : <span className="carrier-text">{c.name}</span>}
                  </span>
                )),
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ---------- 四个核心数字 ---------- */}
      <section className="vc-band">
        <div className="site-wrap vc-grid">
          {[
            { big: "10+", title: t("尾程渠道"), body: t("USPS、UniUni、GOFO、SpeedX、FedEx 等，一次报价全部比较。"), href: "#product", link: t("看看怎么比价"), tone: "blue" },
            { big: "$0", title: t("月费"), body: t("预付余额，按单扣费，没有最低单量。"), href: "#how", link: t("怎么开通"), tone: "teal" },
            { big: "1,000+", title: t("单一次导入"), body: t("Excel 批量导入，逐单比价、合并打印。"), href: "#product", link: t("批量出单"), tone: "violet" },
            hours > 0
              ? { big: `${hours}h`, title: t("内可取消"), body: t("未出面单全额退回余额。"), href: "#faq", link: t("取消规则"), tone: "rose" }
              : { big: "1", title: t("个账户管理所有渠道"), body: t("一张账单，逐单可查。"), href: "#why", link: t("服务保障"), tone: "rose" },
          ].map((v) => (
            <a key={v.title} href={v.href} className={`vc-card ${v.tone}`}>
              <b>{v.big}</b>
              <strong>{v.title}</strong>
              <span>{v.body}</span>
              <em>{v.link} <ArrowRight size={14} /></em>
            </a>
          ))}
        </div>
      </section>

      {/* ---------- 适合谁 ---------- */}
      <section className="us-section tight-top" id="who">
        <div className="site-wrap">
          <div className="us-head center">
            <p className="us-eyebrow">{t("适合谁")}</p>
            <h2>{t("为每天都在发货的你而设计")}</h2>
          </div>
          <WhoTabs />
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

      {/* ---------- 功能亮点：左右交替图文 ---------- */}
      <section className="us-section alt" id="features">
        <div className="site-wrap">
          <div className="us-head center">
            <p className="us-eyebrow">{t("功能亮点")}</p>
            <h2>{t("细节做好，发货少出错")}</h2>
          </div>

          <div className="feat-row">
            <div className="feat-copy">
              <span className="feat-icon violet"><Tag size={20} /></span>
              <h3>{t("面单自动加印 SKU")}</h3>
              <p>{t("拣货打包直接看面单就知道装什么。系统会检查服务商的面单：已经印了 SKU 就不重复加，没有就自动印在空白处。")}</p>
              <ul><li><Check size={15} /> {t("不同渠道的版式分别设置位置")}</li><li><Check size={15} /> {t("原始面单保留，可随时下载")}</li></ul>
            </div>
            <div className="feat-visual">
              <div className="fv-label">
                <div className="fv-label-top"><b>USPS GROUND ADVANTAGE</b><span>ZONE 7</span></div>
                <div className="fv-lines"><i /><i /><i className="short" /></div>
                <div className="fv-bars" aria-hidden="true">{Array.from({ length: 34 }, (_, i) => <i key={i} style={{ width: (i * 7) % 3 + 1 }} />)}</div>
                <div className="fv-stamp">SKU: TEE-BLK-M x2 / CAP-01</div>
              </div>
            </div>
          </div>

          <div className="feat-row rev">
            <div className="feat-copy">
              <span className="feat-icon amber"><MapPinned size={20} /></span>
              <h3>{t("收件地址自动核对")}</h3>
              <p>{t("查运费时就核对地址：缺公寓号、地址不存在会先提醒，写法不标准给出建议地址，少退件、少改派。")}</p>
              <ul><li><Check size={15} /> {t("确认后才能下单")}</li><li><Check size={15} /> {t("批量导入逐单核对")}</li></ul>
            </div>
            <div className="feat-visual">
              <div className="fv-card">
                <div className="fv-addr"><small>{t("收件地址")}</small><b>1200 Broadway, New York, NY 10001</b></div>
                <div className="fv-alert warn"><b>{t("缺少公寓 / 单元号")}</b><span>{t("这栋楼有多个单元，请补充 Apt / Suite")}</span></div>
                <div className="fv-alert ok"><b>{t("建议地址")}</b><span>1200 BROADWAY APT 5C, NEW YORK NY 10001-4318</span></div>
              </div>
            </div>
          </div>

          <div className="feat-row">
            <div className="feat-copy">
              <span className="feat-icon rose"><BellRing size={20} /></span>
              <h3>{t("异常及时提醒")}</h3>
              <p>{t("面单迟迟没出来、服务商返回异常，系统会马上标出来并提醒你，可以立刻换渠道重新下单，不耽误当天发货。")}</p>
              <ul><li><Check size={15} /> {t("同一订单号可以换渠道重下")}</li><li><Check size={15} /> {t("未出面单全额退回")}</li></ul>
            </div>
            <div className="feat-visual">
              <div className="fv-card fv-timeline">
                <div className="done"><i /><b>{t("已下单")}</b><small>10:02</small></div>
                <div className="warn"><i /><b>{t("面单超时未出，已提醒")}</b><small>10:07</small></div>
                <div className="done"><i /><b>{t("换渠道重新出单")}</b><small>10:08</small></div>
                <div className="done"><i /><b>{t("原订单全额退回")}</b><small>10:30</small></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- 覆盖地图 ---------- */}
      <section className="us-map-band" id="coverage">
        <div className="site-wrap us-map-grid">
          <div>
            <p className="us-eyebrow light">{t("覆盖范围")}</p>
            <h2>{t("从洛杉矶，发往全美")}</h2>
            <p className="us-sub light">{t("从洛杉矶发货，覆盖美国本土 48 州。西海岸时效更快，运费更低。")}</p>
            <div className="us-map-stats">
              <div><b>48</b><span>{t("本土州")}</span></div>
              <div><b>Zone 1–8</b><span>{t("全分区报价")}</span></div>
            </div>
          </div>
          <CoverageMap />
        </div>
      </section>

      {/* ---------- 为什么更省 ---------- */}
      <section className="us-section save-band">
        <div className="site-wrap save-grid">
          <div>
            <p className="us-eyebrow">{t("为什么更省")}</p>
            <h2>{t("每一单，都拿当下最低价")}</h2>
            <p className="us-sub">{t("不同重量、不同目的地，最便宜的渠道并不固定。只用一家物流，就会有很多单多付运费；逐单比价，每一单都选最低。")}</p>
          </div>
          <div className="save-card">
            <div className="save-head"><b>{t("100 单运费示意")}</b><span>{t("混合重量 · 全美目的地")}</span></div>
            <div className="save-row">
              <span>{t("固定用一家渠道")}</span>
              <div className="save-bar"><i className="gray" style={{ width: "100%" }} /></div>
              <b>$642</b>
            </div>
            <div className="save-row best">
              <span>{t("逐单自动比价")}</span>
              <div className="save-bar"><i className="grad" style={{ width: "78%" }} /></div>
              <b>$501</b>
            </div>
            <div className="save-foot"><span className="save-chip">−$141</span>{t("示意数据，实际节省取决于你的订单结构")}</div>
          </div>
        </div>
      </section>

      {/* ---------- 合作流程 ---------- */}
      <section className="us-section" id="how">
        <div className="site-wrap">
          <div className="us-head center">
            <p className="us-eyebrow">{t("合作流程")}</p>
            <h2>{t("四步开始发货")}</h2>
          </div>
          <ol className="flow">
            {[
              { icon: MessageSquare, title: t("联系我们"), body: t("说说你的渠道和发货量") },
              { icon: UserCheck, title: t("开通账户"), body: t("确认价格，我们为你开户") },
              { icon: Wallet, title: t("充值余额"), body: t("Zelle 或支付宝") },
              { icon: PackageCheck, title: t("出单发货"), body: t("单个或 Excel 批量") },
            ].map((f, i) => (
              <li key={f.title}>
                <span className={`flow-icon c${i}`}><f.icon size={22} strokeWidth={1.7} /></span>
                <small>0{i + 1}</small>
                <b>{f.title}</b>
                <p>{f.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- 为什么选我们 ---------- */}
      <section className="us-section" id="why">
        <div className="site-wrap">
          <div className="us-head">
            <p className="us-eyebrow">{t("为什么选我们")}</p>
            <h2>{t("服务保障")}</h2>
          </div>
          <div className="lux-cards six">
            {[
              { icon: Headset, tone: "blue", title: t("本地团队"), body: t("就在洛杉矶，中英文沟通，工作时间快速响应。") },
              { icon: Receipt, tone: "violet", title: t("透明计费"), body: t("下单前看到最终价格；补差逐单列明，不重复扣。") },
              { icon: DatabaseBackup, tone: "indigo", title: t("数据每日备份"), body: t("订单、面单、账单每天自动备份，客户数据相互隔离。") },
            ].map((c) => (
              <article key={c.title} className={c.tone}>
                <span className="lux-icon"><c.icon size={20} strokeWidth={1.7} /></span>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 行动区 ---------- */}
      <section className="cta-band">
        <div className="site-wrap cta-in">
          <div>
            <h2>{t("今天就开始省运费")}</h2>
            <ul className="hero-ticks light">
              <li><Check size={16} /> {t("无月费、无最低单量")}</li>
              <li><Check size={16} /> {t("确认价格后为你开户")}</li>
              <li><Check size={16} /> {t("中英文本地服务")}</li>
            </ul>
          </div>
          <div className="cta-actions">
            <Link href="#contact" className="btn us-btn-light lg">{t("联系我们")}</Link>
            <Link href="/portal" className="us-link light">{t("客户登录")} <ArrowRight size={16} /></Link>
          </div>
        </div>
        <div className="site-wrap res-grid">
          {[
            { icon: Calculator, title: t("运费试算"), body: t("选目的地、拖重量，马上看各渠道价格。"), href: "#top" },
            { icon: Map, title: t("覆盖范围"), body: t("从洛杉矶发往美国本土 48 州。"), href: "#coverage" },
            { icon: CircleHelp, title: t("常见问题"), body: t("开户、充值、取消、补差。"), href: "#faq" },
            { icon: LogIn, title: t("客户登录"), body: t("老客户登录下单、查询、对账。"), href: "/portal" },
          ].map((r) => (
            <a key={r.title} href={r.href} className="res-card">
              <r.icon size={20} strokeWidth={1.7} />
              <b>{r.title}</b>
              <span>{r.body}</span>
            </a>
          ))}
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
      <section className="us-section contact-band" id="contact">
        <div className="site-wrap us-apply embed">
          <ContactIntro t={t} lang={lang} site={site} compact />
          <div className="site-apply-card"><ContactForm volumes={VOLUME_OPTIONS} /></div>
        </div>
      </section>

      <footer className="us-footer">
        <div className="site-wrap us-footer-grid wide">
          <div>
            <b className="us-footer-brand">{brand}</b>
            <p>{t("美西本地尾程面单")}</p>
            <p className="us-footer-tag">{t("一个账户比遍主流尾程渠道，预付余额、无月费，洛杉矶本地团队中文服务。")}</p>
            <Link href="#contact" className="btn us-btn" style={{ alignSelf: "flex-start", marginTop: 6 }}>{t("联系我们")}</Link>
          </div>
          <div>
            <h4>{t("产品功能")}</h4>
            <a href="#product">{t("实时比价")}</a>
            <a href="#product">{t("批量导入")}</a>
            <a href="#product">{t("合并打印")}</a>
            <a href="#features">{t("面单自动加印 SKU")}</a>
            <a href="#features">{t("收件地址自动核对")}</a>
            <a href="#product">{t("透明对账")}</a>
          </div>
          <div>
            <h4>{t("支持渠道")}</h4>
            {logos.map((c) => <span key={c.id}>{c.name}</span>)}
          </div>
          <div>
            <h4>{t("适合谁")}</h4>
            <a href="#who">{t("跨境电商卖家")}</a>
            <a href="#who">{t("海外仓 / 3PL")}</a>
            <a href="#who">{t("本地品牌 / 批发商")}</a>
            <h4 style={{ marginTop: 14 }}>{t("帮助")}</h4>
            <a href="#faq">{t("常见问题")}</a>
            <a href="#coverage">{t("覆盖范围")}</a>
          </div>
          <div>
            <h4>{t("联系我们")}</h4>
            <span>{brand}</span>
            <span>{site.address || "Chino, CA 91710"}</span>
            {site.phone && <span>{site.phone}</span>}
            {site.wechat && <span>{t("微信")}{t("：")}{site.wechat}</span>}
            <Link href="/portal">{t("客户登录")}</Link>
          </div>
        </div>
        <div className="site-wrap us-footer-bottom">© {new Date().getFullYear()} {brand} · <Link href="/site/terms">{t("服务条款")}</Link> · <Link href="/site/developers">{t("API 文档")}</Link></div>
      </footer>
    </div>
  );
}
