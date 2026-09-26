import Link from "next/link";
import { ArrowRight, Check, CheckCircle2, FileSpreadsheet, MapPin, MessageCircle, Printer, Receipt, Scale, Undo2 } from "lucide-react";
import { getSettings } from "@/lib/db";
import { getLang, getT } from "@/lib/prefs";
import { CARRIERS, type Carrier } from "@/lib/carriers";
import SiteNav from "./SiteNav";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  const { brandName } = getSettings();
  return {
    title: `${brandName} · ${t("美西本地尾程面单")}`,
    description: t("一个账户比遍 USPS、UniUni、GOFO、SpeedX、FedEx 等渠道，预付余额、无月费，Excel 批量出单，洛杉矶本地团队中文服务。"),
  };
}

function Mark({ c }: { c: Carrier }) {
  return (
    <span className="carrier-mark md">
      {c.logo ? <img src={c.logo} alt={c.name} /> : <span className="carrier-text" style={{ color: c.color }}>{c.name}</span>}
    </span>
  );
}

const carrier = (id: string) => CARRIERS.find((c) => c.id === id)!;

/** 官网首页（客户 OMS 网址的首页）：少文字、多画面，突出比价、本地团队、透明计费 */
export default async function SitePage() {
  const t = await getT();
  const lang = await getLang();
  const s = getSettings();
  const brand = s.brandName;
  const site = s.site;
  const hours = Number(s.cancelWindowHours ?? 48);
  const logos = ["usps", "uniuni", "gofo", "speedx", "swiftx", "fedex"].map(carrier);

  const quotes = [
    { id: "gofo", name: "Gofo Express", price: "3.39", best: true },
    { id: "uniuni", name: "UniUni Express", price: "3.49" },
    { id: "usps", name: "USPS Ground Advantage", price: "5.89" },
    { id: "fedex", name: "FedEx Ground", price: "10.79" },
  ];

  const faq: [string, string][] = [
    [t("有月费或最低单量吗？"), t("没有。按单扣费，开户免费。")],
    [t("怎么充值？"), t("Zelle 或支付宝，提交付款参考号，确认后到账。")],
    [t("可以取消面单吗？"), hours > 0 ? t("下单后 {h} 小时内可以取消；未出面单全额退回。", { h: hours }) : t("可以申请取消；未出面单全额退回。")],
    [t("会有补差吗？"), t("承运商复核重量尺寸后可能补差，逐单列明，同一单不重复扣。")],
  ];

  return (
    <div className="site">
      <div className="site-dark">
        <SiteNav brand={brand} />

        {/* ---------- 首屏 ---------- */}
        <header className="site-hero">
          <div className="site-glow" aria-hidden="true" />
          <div className="site-wrap site-hero-grid">
            <div className="site-hero-copy">
              <span className="site-eyebrow"><MapPin size={13} /> {t("洛杉矶 Chino 本地发货")}</span>
              <h1>
                {t("尾程面单")}
                <br />
                <span className="site-grad">{t("省到每一分")}</span>
              </h1>
              <p className="site-lead">{t("多家渠道实时比价，自动选最便宜。无月费，按单付费。")}</p>
              <div className="site-cta">
                <Link href="/site/apply" className="btn site-btn-primary lg">{t("免费开户")} <ArrowRight size={16} /></Link>
                <Link href="/portal" className="btn site-btn-ghost lg">{t("登录")}</Link>
              </div>
              <div className="site-stats">
                <div><b>$0</b><span>{t("月费")}</span></div>
                <div><b>6+</b><span>{t("尾程渠道")}</span></div>
                {hours > 0 && <div><b>{hours}h</b><span>{t("内可取消")}</span></div>}
              </div>
            </div>

            <div className="site-visual" aria-label={t("报价示例")}>
              <div className="site-glass">
                <div className="site-glass-head">
                  <span>91710 → 90001 · 1.5 lb</span>
                  <span className="site-live"><i /> {t("实时报价")}</span>
                </div>
                {quotes.map((q, i) => (
                  <div key={q.id} className={`site-q${q.best ? " best" : ""}`} style={{ animationDelay: `${0.15 + i * 0.12}s` }}>
                    <Mark c={carrier(q.id)} />
                    <span className="site-q-name">{q.name}</span>
                    {q.best && <span className="site-q-tag">{t("最低")}</span>}
                    <b className="site-q-price">${q.price}</b>
                  </div>
                ))}
                <p className="site-glass-note">{t("示意，以实时报价为准")}</p>
              </div>
              <div className="site-chip one"><CheckCircle2 size={15} /> {t("地址已核对")}</div>
              <div className="site-chip two"><Printer size={15} /> {t("面单已生成")}</div>
            </div>
          </div>
        </header>

        {/* ---------- 渠道滚动条 ---------- */}
        <div className="site-marquee" aria-label={t("支持的尾程渠道")}>
          <div className="site-marquee-track">
            {[...logos, ...logos, ...logos].map((c, i) => <Mark key={i} c={c} />)}
          </div>
        </div>
      </div>

      {/* ---------- 亮点（Bento） ---------- */}
      <section className="site-section" id="why">
        <div className="site-wrap">
          <h2 className="site-h2 reveal">{t("省钱，也省心")}</h2>
          <div className="site-bento">
            <article className="tile wide reveal">
              <div className="tile-copy"><Scale size={18} /><h3>{t("自动选最便宜")}</h3><p>{t("多家渠道同时报价")}</p></div>
              <div className="viz-bars">
                {[["Gofo", 34, "$3.39", true], ["UniUni", 36, "$3.49"], ["USPS", 58, "$5.89"], ["FedEx", 100, "$10.79"]].map(([n, w, p, best]) => (
                  <div key={n as string} className={best ? "best" : ""}>
                    <span>{n}</span><i style={{ width: `${w}%` }} /><b>{p}</b>
                  </div>
                ))}
              </div>
            </article>

            <article className="tile reveal">
              <div className="tile-copy"><MessageCircle size={18} /><h3>{t("本地中文客服")}</h3><p>{t("微信直接找人")}</p></div>
              <div className="viz-chat">
                <span className="me">{t("这单能改地址吗？")}</span>
                <span className="them">{t("可以，马上处理 👍")}</span>
              </div>
            </article>

            <article className="tile reveal">
              <div className="tile-copy"><Receipt size={18} /><h3>{t("账目透明")}</h3><p>{t("每笔都有明细")}</p></div>
              <div className="viz-ledger">
                <div><span>{t("运费")}</span><b>−$3.39</b></div>
                <div><span>{t("补差")}</span><b>−$0.42</b></div>
                <div className="pos"><span>{t("充值")}</span><b>+$500.00</b></div>
              </div>
            </article>

            <article className="tile reveal">
              <div className="tile-copy"><FileSpreadsheet size={18} /><h3>{t("Excel 批量出单")}</h3><p>{t("上千单一次导入")}</p></div>
              <div className="viz-progress">
                <div className="viz-progress-top"><span>orders.xlsx</span><b>1,248 / 1,248</b></div>
                <div className="viz-progress-bar"><i /></div>
              </div>
            </article>

            <article className="tile reveal">
              <div className="tile-copy"><MapPin size={18} /><h3>{t("地址自动核对")}</h3><p>{t("少退件、少改派")}</p></div>
              <div className="viz-addr">
                <span>1200 E Florence Ave</span>
                <span>Los Angeles, CA 90001</span>
                <em><Check size={13} /> {t("已核对")}</em>
              </div>
            </article>

            <article className="tile wide reveal">
              <div className="tile-copy"><Printer size={18} /><h3>{t("合并打印")}</h3><p>4×6 · A4 · Letter</p></div>
              <div className="viz-labels">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="lbl" style={{ ["--i" as string]: i }}>
                    <span className="lbl-top" />
                    <span className="lbl-line" /><span className="lbl-line short" />
                    <span className="lbl-code" />
                  </div>
                ))}
              </div>
            </article>

            <article className="tile reveal accent">
              <div className="tile-copy"><Undo2 size={18} /><h3>{hours > 0 ? t("{h} 小时内可取消", { h: hours }) : t("随时申请取消")}</h3><p>{t("未出面单全额退")}</p></div>
              <div className="viz-big">{hours > 0 ? `${hours}h` : "↺"}</div>
            </article>
          </div>
        </div>
      </section>

      {/* ---------- 三步 ---------- */}
      <section className="site-section tight" id="how">
        <div className="site-wrap">
          <h2 className="site-h2 reveal">{t("三步开始出单")}</h2>
          <ol className="site-steps3 reveal">
            <li><span>1</span><b>{t("申请开户")}</b><p>{t("留个联系方式")}</p></li>
            <li><span>2</span><b>{t("充值")}</b><p>Zelle · {t("支付宝")}</p></li>
            <li><span>3</span><b>{t("出单")}</b><p>{t("单个或 Excel 批量")}</p></li>
          </ol>
        </div>
      </section>

      {/* ---------- 常见问题 ---------- */}
      <section className="site-section tight" id="faq">
        <div className="site-wrap site-narrow">
          <h2 className="site-h2 reveal">{t("常见问题")}</h2>
          <div className="site-faq reveal">
            {faq.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 结尾 ---------- */}
      <section className="site-dark site-final">
        <div className="site-glow bottom" aria-hidden="true" />
        <div className="site-wrap">
          <h2>{t("今天就开始省运费")}</h2>
          <div className="site-cta center">
            <Link href="/site/apply" className="btn site-btn-primary lg">{t("免费开户")} <ArrowRight size={16} /></Link>
            <Link href="/portal" className="btn site-btn-ghost lg">{t("登录")}</Link>
          </div>
          {(site.wechat || site.phone || site.email) && (
            <div className="site-contact">
              {site.wechat && <span>{t("微信")} <b>{site.wechat}</b></span>}
              {site.phone && <span>{t("电话")} <b>{site.phone}</b></span>}
              {site.email && <span>{t("邮箱")} <a href={`mailto:${site.email}`}>{site.email}</a></span>}
            </div>
          )}
        </div>
      </section>

      <footer className="site-footer">
        <div className="site-wrap">
          <span><b>{brand}</b> · {site.company}{site.address ? ` · ${site.address}` : ""}</span>
          {site.hours && <span>{lang === "en" ? t(site.hours) : site.hours}</span>}
          <span>© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}
