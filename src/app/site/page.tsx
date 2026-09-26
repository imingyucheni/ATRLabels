import Link from "next/link";
import { ArrowRight, Check, Clock, FileSpreadsheet, MapPin, Receipt, Scale } from "lucide-react";
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

const carrier = (id: string) => CARRIERS.find((c) => c.id === id)!;

function Mark({ c, mono = false }: { c: Carrier; mono?: boolean }) {
  return (
    <span className={`carrier-mark md${mono ? " mono" : ""}`}>
      {c.logo ? <img src={c.logo} alt={c.name} /> : <span className="carrier-text" style={{ color: mono ? undefined : c.color }}>{c.name}</span>}
    </span>
  );
}

/** 官网首页：美式 B2B 风格——白底、深海军蓝、单一强调色、克制的排版 */
export default async function SitePage() {
  const t = await getT();
  const lang = await getLang();
  const s = getSettings();
  const brand = s.brandName;
  const site = s.site;
  const hours = Number(s.cancelWindowHours ?? 48);
  const logos = ["usps", "uniuni", "gofo", "speedx", "swiftx", "fedex"].map(carrier);

  const rates = [
    { id: "gofo", service: "Gofo Express", days: t("2–5 天"), price: "3.39", best: true },
    { id: "uniuni", service: "UniUni Express", days: t("2–5 天"), price: "3.49" },
    { id: "usps", service: "USPS Ground Advantage", days: t("2–5 天"), price: "5.89" },
    { id: "fedex", service: "FedEx Ground", days: t("1–5 天"), price: "10.79" },
  ];

  const faq: [string, string][] = [
    [t("有月费或最低单量吗？"), t("没有。按单扣费，开户免费。")],
    [t("怎么充值？"), t("Zelle 或支付宝，提交付款参考号，确认后到账。")],
    [t("可以取消面单吗？"), hours > 0 ? t("下单后 {h} 小时内可以取消；未出面单全额退回。", { h: hours }) : t("可以申请取消；未出面单全额退回。")],
    [t("会有补差吗？"), t("承运商复核重量尺寸后可能补差，逐单列明，同一单不重复扣。")],
  ];

  return (
    <div className="site">
      <SiteNav brand={brand} />

      {/* ---------- Hero ---------- */}
      <header className="us-hero">
        <div className="site-wrap us-hero-grid">
          <div>
            <p className="us-eyebrow">{t("美西尾程 · 洛杉矶")}</p>
            <h1><span className="l">{t("每个渠道，")}</span><span className="l">{t("一个账户，")}</span><span className="l accent">{t("最低运费。")}</span></h1>
            <p className="us-lead">{t("实时比较 USPS、UniUni、GOFO、FedEx 等渠道报价，自动选出最低价。预付余额，无月费。")}</p>
            <div className="us-cta">
              <Link href="/site/apply" className="btn us-btn lg">{t("免费开户")}</Link>
              <Link href="/portal" className="us-link">{t("登录账户")} <ArrowRight size={16} /></Link>
            </div>
            <p className="us-fine">{t("无月费")} · {t("无最低单量")}{hours > 0 ? ` · ${t("{h} 小时内可取消", { h: hours })}` : ""}</p>
          </div>

          {/* 产品界面示意 */}
          <div className="us-window" aria-label={t("报价示例")}>
            <div className="us-window-bar"><i /><i /><i /><span>{t("运费比价")}</span></div>
            <div className="us-window-body">
              <div className="us-route">
                <div><small>{t("发件")}</small><b>Chino, CA 91710</b></div>
                <ArrowRight size={16} />
                <div><small>{t("收件")}</small><b>Los Angeles, CA 90001</b></div>
                <div className="us-route-w"><small>{t("重量")}</small><b>1.5 lb</b></div>
              </div>
              <table className="us-rates">
                <tbody>
                  {rates.map((r) => (
                    <tr key={r.id} className={r.best ? "best" : ""}>
                      <td><Mark c={carrier(r.id)} /></td>
                      <td><b>{r.service}</b><small>{r.days}</small></td>
                      <td className="num">{r.best && <em>{t("最低价")}</em>}<b>${r.price}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="us-window-note">{t("示意，以实时报价为准")}</p>
            </div>
          </div>
        </div>

        <div className="site-wrap us-logos">
          <span>{t("支持的尾程渠道")}</span>
          <div>{logos.map((c) => <Mark key={c.id} c={c} mono />)}</div>
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

      {/* ---------- Pillars ---------- */}
      <section className="us-section" id="why">
        <div className="site-wrap">
          <div className="us-head">
            <p className="us-eyebrow">{t("为什么选我们")}</p>
            <h2>{t("为专业卖家打造")}</h2>
          </div>
          <div className="us-pillars">
            <div><span>01</span><Scale size={22} strokeWidth={1.6} /><h3>{t("实时比价")}</h3><p>{t("多家渠道同时报价，自动选最低。")}</p></div>
            <div><span>02</span><FileSpreadsheet size={22} strokeWidth={1.6} /><h3>{t("批量出单")}</h3><p>{t("Excel 导入上千单，一次打印。")}</p></div>
            <div><span>03</span><Receipt size={22} strokeWidth={1.6} /><h3>{t("透明计费")}</h3><p>{t("每笔扣款、补差逐单可查。")}</p></div>
          </div>
        </div>
      </section>

      {/* ---------- Feature rows ---------- */}
      <section className="us-section alt" id="how">
        <div className="site-wrap">
          <div className="us-row">
            <div className="us-row-copy">
              <p className="us-eyebrow">{t("批量出单")}</p>
              <h2>{t("从 Excel 到面单，几分钟完成")}</h2>
              <ul className="us-list">
                <li><Check size={16} /> {t("逐单自动选最低渠道")}</li>
                <li><Check size={16} /> {t("收件地址自动核对")}</li>
                <li><Check size={16} /> {t("4×6、A4、Letter 合并打印")}</li>
              </ul>
            </div>
            <div className="us-panel">
              <div className="us-panel-head"><FileSpreadsheet size={16} /> orders_0926.xlsx <span className="us-pill ok">{t("已完成")}</span></div>
              <div className="us-kpis">
                <div><small>{t("订单")}</small><b>1,248</b></div>
                <div><small>{t("已出面单")}</small><b>1,248</b></div>
                <div><small>{t("地址问题")}</small><b>0</b></div>
              </div>
              <div className="us-bar"><i /></div>
            </div>
          </div>

          <div className="us-row reverse">
            <div className="us-row-copy">
              <p className="us-eyebrow">{t("透明计费")}</p>
              <h2>{t("每一分钱，都有记录")}</h2>
              <ul className="us-list">
                <li><Check size={16} /> {t("下单前看到最终价格")}</li>
                <li><Check size={16} /> {t("补差逐单列明，不重复扣")}</li>
                <li><Check size={16} /> {t("对账明细随时导出")}</li>
              </ul>
            </div>
            <div className="us-panel">
              <table className="us-ledger">
                <thead><tr><th>{t("日期")}</th><th>{t("说明")}</th><th className="num">{t("金额")}</th></tr></thead>
                <tbody>
                  <tr><td>09/26</td><td>{t("运费")} · Gofo Express</td><td className="num">−$3.39</td></tr>
                  <tr><td>09/26</td><td>{t("补差")} · {t("重量复核")}</td><td className="num">−$0.42</td></tr>
                  <tr><td>09/25</td><td>{t("充值")} · Zelle</td><td className="num pos">+$500.00</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Local support ---------- */}
      <section className="us-section">
        <div className="site-wrap us-local">
          <div>
            <p className="us-eyebrow">{t("本地服务")}</p>
            <h2>{t("就在洛杉矶，随时找得到人")}</h2>
            <p className="us-sub">{t("中英文沟通，工作时间快速响应。")}</p>
          </div>
          <div className="us-local-card">
            <div><MapPin size={18} strokeWidth={1.6} /><span>{site.company}<br />{site.address || "Chino, CA 91710"}</span></div>
            {site.hours && <div><Clock size={18} strokeWidth={1.6} /><span>{lang === "en" ? t(site.hours) : site.hours}</span></div>}
            {(site.wechat || site.phone || site.email) && (
              <div className="us-local-contact">
                {site.wechat && <span>{t("微信")} <b>{site.wechat}</b></span>}
                {site.phone && <span>{t("电话")} <b>{site.phone}</b></span>}
                {site.email && <span>{t("邮箱")} <a href={`mailto:${site.email}`}>{site.email}</a></span>}
              </div>
            )}
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
          <dl>
            {faq.map(([q, a]) => (
              <div key={q}><dt>{q}</dt><dd>{a}</dd></div>
            ))}
          </dl>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="us-cta-band">
        <div className="site-wrap">
          <h2>{t("准备好降低运费了吗？")}</h2>
          <div className="us-cta">
            <Link href="/site/apply" className="btn us-btn-light lg">{t("免费开户")}</Link>
            <Link href="/portal" className="us-link light">{t("登录账户")} <ArrowRight size={16} /></Link>
          </div>
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
            <a href="#why">{t("实时比价")}</a>
            <a href="#how">{t("批量出单")}</a>
            <a href="#faq">{t("常见问题")}</a>
          </div>
          <div>
            <h4>{t("账户")}</h4>
            <Link href="/site/apply">{t("免费开户")}</Link>
            <Link href="/portal">{t("登录账户")}</Link>
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
