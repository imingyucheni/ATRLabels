import Link from "next/link";
import {
  ArrowRight, BadgeDollarSign, Check, FileSpreadsheet, Headset, MapPin, MapPinned, Minus, Printer, Receipt, Scale, ShieldCheck, Undo2, Wallet,
} from "lucide-react";
import { getSettings } from "@/lib/db";
import { getLang, getT } from "@/lib/prefs";
import { CARRIERS } from "@/lib/carriers";
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

/** 官网首页（客户 OMS 网址的首页）：介绍服务、突出优势，引导申请开户 / 登录 */
export default async function SitePage() {
  const t = await getT();
  const lang = await getLang();
  const s = getSettings();
  const site = { ...s.site };
  const brand = s.brandName;
  const cancelPct = s.cancelFeePercent;
  const carriers = ["usps", "uniuni", "gofo", "speedx", "swiftx", "fedex"].map((id) => CARRIERS.find((c) => c.id === id)!);

  const sample = [
    { carrier: "gofo", name: "Gofo Express", days: t("2–5 天"), price: "3.39", best: true },
    { carrier: "uniuni", name: "UniUni Express", days: t("2–5 天"), price: "3.49" },
    { carrier: "usps", name: "USPS Ground Advantage", days: t("2–5 天"), price: "5.89" },
    { carrier: "fedex", name: "FedEx Ground", days: t("1–5 天"), price: "10.79" },
  ];

  const features = [
    { icon: Scale, title: t("多家渠道，一次比价"), body: t("USPS、UniUni、GOFO、SpeedX、SwiftX、FedEx 等渠道同时报价，按价格排好。不同重量、不同邮编最便宜的渠道不一样，系统帮你挑。") },
    { icon: MapPin, title: t("美西本地仓，本地团队"), body: t("我们在 Chino, CA 91710，洛杉矶本地发货。中文、英文都能沟通，微信直接找到人，不用等工单、不用算时差。") },
    { icon: Receipt, title: t("价格透明，账目清楚"), body: t("下单前就看到最终运费。每笔扣款、退款、补差都有明细，随时导出对账；同一单的补差绝不重复扣。") },
    { icon: Wallet, title: t("预付余额，没有月费"), body: t("Zelle、支付宝充值，按单扣费。没有月费、没有最低单量、没有开户费，出多少单付多少钱。") },
    { icon: FileSpreadsheet, title: t("Excel 批量出单"), body: t("一次导入上千单，逐单自动选最便宜的渠道；面单合并打印，4×6、A4、Letter 都支持，还能在面单上加印 SKU，方便仓库拣货。") },
    { icon: MapPinned, title: t("收件地址自动核对"), body: t("下单时自动核对收件地址：地址不存在、缺公寓号会提醒，写法不标准给出建议地址，减少退件和改派费用。") },
  ];

  const compare: [string, string, string][] = [
    [t("可选渠道"), t("多家服务商的渠道放在一起比价"), t("通常只有平台自己的渠道")],
    [t("客服"), t("洛杉矶本地团队，中文 / 英文，微信直接联系"), t("工单或邮件，常有时差")],
    [t("门槛"), t("无月费、无最低单量、无开户费"), t("常见月费或单量要求")],
    [t("补差价"), t("按承运商账单逐单列明，同一单不重复扣"), t("合并扣款，不容易核对")],
    [t("取消面单"), t("未出面单全额退回余额"), t("视平台规则")],
    [t("充值方式"), t("Zelle、支付宝"), t("多为信用卡")],
  ];

  const steps = [
    { n: 1, title: t("申请开户"), body: t("填写联系方式，我们会尽快联系你，确认渠道和价格。") },
    { n: 2, title: t("充值余额"), body: t("Zelle 或支付宝转账，填写付款参考号，财务确认后到账。") },
    { n: 3, title: t("下单出面单"), body: t("单个下单，或上传 Excel 批量导入，系统自动比价。") },
    { n: 4, title: t("打印发货"), body: t("下载或合并打印面单，贴上就能发货，物流单号自动回传。") },
  ];

  const faq: [string, string][] = [
    [t("需要月费或最低单量吗？"), t("不需要。按单扣费，没有月费、没有最低单量，也不收开户费。")],
    [t("怎么充值？多久到账？"), t("支持 Zelle 和支付宝。转账后在系统里提交充值申请并填写付款参考号，财务确认后即到账，工作时间内一般很快。")],
    [t("支持哪些渠道？"), t("USPS、UniUni、GOFO、SpeedX、SwiftX、FedEx 等美国本地尾程渠道，具体以你账户开通的为准。系统会根据收件地址和重量只显示送得到的渠道。")],
    [t("面单打错了能取消吗？"), cancelPct > 0 ? t("还没出面单的订单取消后全额退回余额；已出面单的可以申请取消，收取 {pct}% 手续费。", { pct: cancelPct }) : t("还没出面单的订单取消后全额退回余额；已出面单的可以申请取消。")],
    [t("会有补差价吗？"), t("承运商核实包裹实际重量、尺寸后可能产生补差。补差按账单逐单列明，在系统里可以查看和导出，同一单不会重复扣。")],
    [t("可以用 Excel 批量下单吗？"), t("可以。下载导入模板填好上传即可，也兼容常见的导单表格格式；系统逐单比价，你确认后一次提交。")],
  ];

  const contact = [
    site.wechat && { label: t("微信"), value: site.wechat },
    site.phone && { label: t("电话"), value: site.phone },
    site.email && { label: t("邮箱"), value: site.email, href: `mailto:${site.email}` },
  ].filter(Boolean) as { label: string; value: string; href?: string }[];

  return (
    <div className="site">
      <SiteNav brand={brand} />

      {/* ---------- 首屏 ---------- */}
      <header className="site-hero">
        <div className="site-wrap site-hero-grid">
          <div>
            <span className="site-eyebrow"><MapPin size={14} /> {t("Chino, CA 91710 · 洛杉矶本地发货")}</span>
            <h1>{t("美西尾程面单，")}<br /><em>{t("一个账户比遍所有渠道")}</em></h1>
            <p className="site-lead">{t("USPS、UniUni、GOFO、SpeedX、FedEx 同时报价，自动挑最便宜的。预付余额、没有月费，Excel 批量出单，本地团队中文服务。")}</p>
            <div className="site-cta">
              <Link href="/site/apply" className="btn primary lg">{t("申请开户")} <ArrowRight size={16} /></Link>
              <Link href="/portal" className="btn lg">{t("已有账户，登录")}</Link>
            </div>
            <ul className="site-ticks">
              <li><Check size={15} /> {t("无月费")}</li>
              <li><Check size={15} /> {t("无最低单量")}</li>
              <li><Check size={15} /> {t("未出面单全额退")}</li>
            </ul>
          </div>

          <div className="site-mock" aria-label={t("报价示例")}>
            <div className="site-mock-head">
              <div>
                <b>{t("运费比价")}</b>
                <span>Chino, CA 91710 → Los Angeles, CA 90001 · 1.5 lb</span>
              </div>
              <span className="badge ok">{t("{n} 个渠道可用", { n: sample.length })}</span>
            </div>
            {sample.map((q) => {
              const c = CARRIERS.find((x) => x.id === q.carrier)!;
              return (
                <div key={q.carrier} className={`site-quote${q.best ? " best" : ""}`}>
                  <span className="carrier-mark md">
                    {c.logo ? <img src={c.logo} alt={c.name} /> : <span className="carrier-text" style={{ color: c.color }}>{c.name}</span>}
                  </span>
                  <div className="site-quote-name"><b>{q.name}</b><span>{q.days}</span></div>
                  {q.best && <span className="site-best">{t("最便宜")}</span>}
                  <div className="site-quote-price">${q.price}</div>
                </div>
              );
            })}
            <p className="site-mock-note">{t("示意图，价格仅供参考，以登录后的实时报价为准")}</p>
          </div>
        </div>
      </header>

      {/* ---------- 渠道 ---------- */}
      <section className="site-carriers">
        <div className="site-wrap">
          <p>{t("支持的尾程渠道")}</p>
          <div className="site-carrier-row">
            {carriers.map((c) => (
              <span key={c.id} className="carrier-mark md">
                {c.logo ? <img src={c.logo} alt={c.name} /> : <span className="carrier-text" style={{ color: c.color }}>{c.name}</span>}
              </span>
            ))}
            <span className="site-more">{t("更多渠道持续接入")}</span>
          </div>
        </div>
      </section>

      {/* ---------- 优势 ---------- */}
      <section className="site-section" id="why">
        <div className="site-wrap">
          <div className="site-head">
            <span className="site-kicker">{t("为什么选我们")}</span>
            <h2>{t("省钱，也省心")}</h2>
            <p>{t("大平台给你的是一个工具；我们给你的是工具，加上一个随时找得到的本地团队。")}</p>
          </div>
          <div className="site-features">
            {features.map((f) => (
              <div key={f.title} className="site-feature">
                <span className="site-icon"><f.icon size={20} strokeWidth={1.8} /></span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 对比 ---------- */}
      <section className="site-section alt" id="compare">
        <div className="site-wrap">
          <div className="site-head">
            <span className="site-kicker">{t("对比")}</span>
            <h2>{t("和一般打单平台有什么不同")}</h2>
          </div>
          <div className="site-compare card">
            <table>
              <thead>
                <tr><th></th><th className="us">{brand}</th><th>{t("一般打单平台")}</th></tr>
              </thead>
              <tbody>
                {compare.map(([k, us, them]) => (
                  <tr key={k}>
                    <th scope="row">{k}</th>
                    <td className="us"><Check size={16} /> {us}</td>
                    <td className="them"><Minus size={16} /> {them}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------- 流程 ---------- */}
      <section className="site-section" id="how">
        <div className="site-wrap">
          <div className="site-head">
            <span className="site-kicker">{t("开始使用")}</span>
            <h2>{t("四步开始出单")}</h2>
          </div>
          <ol className="site-steps">
            {steps.map((st) => (
              <li key={st.n}>
                <span className="site-step-n">{st.n}</span>
                <h3>{st.title}</h3>
                <p>{st.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- 工具亮点 ---------- */}
      <section className="site-section alt">
        <div className="site-wrap site-tools">
          {[
            { icon: Printer, title: t("合并打印"), body: t("勾选多张面单一次打印，4×6 / A4 / Letter 任选。") },
            { icon: Undo2, title: t("一键取消"), body: t("未出面单的订单取消后运费立刻退回余额。") },
            { icon: BadgeDollarSign, title: t("余额提醒"), body: t("余额不足、面单异常、补差都会邮件通知，可以按需关闭。") },
            { icon: ShieldCheck, title: t("数据安全"), body: t("数据每天自动备份；客户之间数据完全隔离。") },
            { icon: Headset, title: t("真人服务"), body: t("有问题直接找我们，中文沟通，不用绕客服机器人。") },
          ].map((x) => (
            <div key={x.title} className="site-tool">
              <x.icon size={18} strokeWidth={1.8} />
              <div><b>{x.title}</b><p>{x.body}</p></div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- 常见问题 ---------- */}
      <section className="site-section" id="faq">
        <div className="site-wrap site-narrow">
          <div className="site-head">
            <span className="site-kicker">FAQ</span>
            <h2>{t("常见问题")}</h2>
          </div>
          <div className="site-faq">
            {faq.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 结尾 CTA ---------- */}
      <section className="site-final">
        <div className="site-wrap">
          <h2>{t("把省下来的运费，留给你的利润")}</h2>
          <p>{t("开户免费，几分钟填好申请，我们尽快联系你。")}</p>
          <div className="site-cta center">
            <Link href="/site/apply" className="btn primary lg">{t("申请开户")} <ArrowRight size={16} /></Link>
            <Link href="/portal" className="btn lg">{t("登录")}</Link>
          </div>
          {contact.length > 0 && (
            <div className="site-contact">
              {contact.map((c) => (
                <span key={c.label}>{c.label}：{c.href ? <a href={c.href}>{c.value}</a> : <b>{c.value}</b>}</span>
              ))}
            </div>
          )}
        </div>
      </section>

      <footer className="site-footer">
        <div className="site-wrap">
          <div>
            <b>{brand}</b>
            <span>{site.company}{site.address ? ` · ${site.address}` : ""}</span>
            {site.hours && <span>{lang === "en" ? t(site.hours) : site.hours}</span>}
          </div>
          <div className="site-footer-links">
            <a href="#why">{t("优势")}</a>
            <a href="#compare">{t("对比")}</a>
            <a href="#faq">{t("常见问题")}</a>
            <Link href="/portal">{t("登录")}</Link>
          </div>
          <small>© {new Date().getFullYear()} {site.company || brand}</small>
        </div>
      </footer>
    </div>
  );
}
