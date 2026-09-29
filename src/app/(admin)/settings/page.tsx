import { fmtTime } from "@/lib/time";
import { labelSkuStats } from "@/lib/labelSku";
import { describeRule, listMarkupLog, MARKUP_SCOPE_LABEL } from "@/lib/markup";
import { DEFAULT_MIN, defaultLimits, limitsFor, savedLimits } from "@/lib/channelLimits";
import { acceptedCount, getTerms, unsignedCustomers, usingDefaultTerms } from "@/lib/terms";
import { ADJUSTMENT_POLICY_LABEL, channelCustomerCounts, getSettings, listChannels } from "@/lib/db";
import { BALANCE_RULE_LABEL } from "@/lib/ledger";
import { computePrice, money, resolveRule, type MarkupRule } from "@/lib/pricing";
import { isSandboxSite, shipbestConfig, type ShipBestMode } from "@/lib/shipbest/client";
import { isProductionSite, siteSwitch } from "@/lib/sites";
import StampSettings from "@/components/StampSettings";
import SettingsSection, { SettingsToggleAll } from "@/components/SettingsSection";
import FlashForm from "@/components/FlashForm";
import RuleInputs from "@/components/RuleInputs";
import { DEFAULT_JG_WAREHOUSES, isJiaguCode, JG_PREFIX, JG_SUFFIX } from "@/lib/shipbest/jiagu";
import { saveTermsAction, saveSiteAction, saveJiaguAction, testJiaguAction, resetTestEnvAction, resetSandboxAction, resetTermsAction, saveChannelLimitsAction, saveSmtpAction, testMailAction, setFinancePinAction, clearTestDataAction, saveAddrCheckAction, testAddrAction, refreshFxAction, saveChannelsAction, savePaymentSettingsAction, saveSettingsAction, saveShipBestAction, syncChannelsAction, verifyAction } from "@/app/actions";
import { cnyToPay, usdCnyQuote } from "@/lib/fx";
import FilePick from "@/components/FilePick";
import { CarrierMark } from "@/components/ChannelLabel";
import { CARRIERS, carrierById, defaultPublicName, guessCarrier, publicChannel } from "@/lib/carriers";
import { hasTestData, testDataStats } from "@/lib/cleanup";
import { currentEnv } from "@/lib/db";
import { addrConfig, monthlyUsage } from "@/lib/addressCheck";
import { hasFinancePin } from "@/lib/financePin";
import { smtpConfig } from "@/lib/mailer";
import { NOTIFY_EVENTS, NOTIFY_LABEL, recentEmailLog } from "@/lib/notify";
import { getLang, getT } from "@/lib/prefs";
import type { T } from "@/lib/i18n";

const MODE_BADGE: Record<ShipBestMode, string> = { mock: "当前：模拟模式", sandbox: "当前：沙盒模式", live: "当前：正式模式" };
const MODE_NAME: Record<ShipBestMode, string> = { mock: "模拟", sandbox: "沙盒", live: "正式" };
const MODE_DESC: Record<ShipBestMode, string> = {
  mock: "不连 ShipBest。价格按导入的报价表估算，面单是模拟的。适合演示、培训。",
  sandbox: "渠道和运费是 ShipBest 实时报价（不花钱），下单和面单是模拟的，不扣 ShipBest 余额。适合上线前核对价格、测试新功能。",
  live: "真实报价、真实出单，ShipBest 会扣费，面单可以直接贴。正式营业用这个。",
};

export default async function SettingsPage() {
  const s = getSettings();
  const fx = await usdCnyQuote();
  const channels = listChannels();
  const opened = channelCustomerCounts();
  const sb = shipbestConfig();
  const sbSaved = s.shipbest ?? { mode: "env", apiId: "", token: "" };
  const example = [5, 10, 20];
  const t = await getT();
  const lang = await getLang();
  const fxSource = t(fx.source).replace(/ · (\S+) 今日汇率$/, (_, d) => t(" · {d} 今日汇率", { d })).replace(/（最近一次）$/, t("（最近一次）"));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("设置")}</h1>
          <p className="page-sub">{t("已经设置好的项目默认收起，点标题展开；需要处理的项目默认展开。")}</p>
        </div>
        <SettingsToggleAll />
      </div>

      <SettingsSection
        id="shipbest"
        title={t("ShipBest 连接")}
        defaultOpen={(sb.mode !== "mock" && (!sb.apiId || !sb.token)) || channels.length === 0}
        summary={t("启用 {a} 个渠道", { a: channels.filter((c) => c.enabled).length })}
        badge={sb.mode !== "mock" && (!sb.apiId || !sb.token) ? (
          // 正式 / 沙盒模式但没填 API 账号：接口调不通，不能显示成“正常”的绿色
          <span className="badge exception">{t(sb.mode === "live" ? "正式模式 · 未填写 API 账号" : "沙盒模式 · 未填写 API 账号")}</span>
        ) : (
          <span className={`badge ${sb.mode === "live" ? "ok" : sb.mode === "sandbox" ? "test" : "pending"}`}>{t(MODE_BADGE[sb.mode])}</span>
        )}
      >
        {isSandboxSite() && (
          <div className="alert warn" style={{ marginTop: 12 }}>{t("这里是沙盒站：数据和正式站分开，永远不会真实出单。选“正式”也会按沙盒处理。")}</div>
        )}
        {isProductionSite() && (
          <div className="alert" style={{ marginTop: 12 }}>
            {t("正式站只使用正式数据、真实出单，客户永远看不到任何测试数据。需要测试新功能或渠道时，请到沙盒站：沙盒站是完全独立的一套数据，不会真实出单、不发邮件、客户不能登录，可以随时清空。")}
            {siteSwitch()?.toSandbox && <> <a href={siteSwitch()!.url} target="_blank">{t("打开沙盒站")}</a></>}
          </div>
        )}
        {!isProductionSite() && (
        <p className="small muted" style={{ marginTop: 10 }}>
          {t("模拟和沙盒模式使用单独的测试数据（第一次切换时复制正式环境的客户、渠道和设置，订单、充值、余额从零开始），测试时的操作不会进入正式数据。")}
        </p>
        )}
        {currentEnv() === "test" && !isSandboxSite() && (
          <div className="row" style={{ marginBottom: 8 }}>
            <FlashForm action={resetTestEnvAction} submitLabel="用正式数据重置测试环境" submitClass="small" inline confirm="清空所有测试订单、充值和余额，并重新复制正式环境的客户、渠道和设置？" />
          </div>
        )}
        <div className="mode-cards">
          {(["mock", "sandbox", "live"] as const).map((m) => (
            <div key={m} className={`mode-card${sb.mode === m ? " on" : ""}`}>
              <b>{t(MODE_NAME[m])}</b>
              <span>{t(MODE_DESC[m])}</span>
            </div>
          ))}
        </div>
        <FlashForm action={saveShipBestAction} submitLabel="保存并测试连接" locked="切换模式或更换账号会影响所有客户的报价和出单" confirm="确定修改 ShipBest 连接吗？切到“正式”后所有客户下单都会真实出单扣费；切到“模拟 / 沙盒”后客户下的单都是测试单，面单不能用。">
          <div className="grid" style={{ margin: "12px 0" }}>
            {isProductionSite() ? (
              <label className="f">{t("模式")}
                <input type="hidden" name="mode" value="live" />
                <input value={t("正式（正式站固定，测试请到沙盒站）")} disabled />
              </label>
            ) : (
            <label className="f">{t("模式")}
              <select name="mode" defaultValue={sbSaved.mode === "env" ? sb.mode : sbSaved.mode}>
                <option value="mock">{t("模拟（不连 ShipBest，按报价表估算）")}</option>
                <option value="sandbox">{t("沙盒（真实报价，模拟出单，不扣费）")}</option>
                <option value="live" disabled={isSandboxSite()}>{t("正式（真实报价、真实出单扣费）")}{isSandboxSite() ? t("（沙盒站不可用）") : ""}</option>
              </select>
            </label>
            )}
            <label className="f">API ID
              <input name="apiId" defaultValue={sbSaved.apiId || (sb.source === "env" ? sb.apiId : "")} placeholder={t("OMS 后台 → API 配置里的 ID")} autoComplete="off" />
            </label>
            <label className="f">API Token
              <input name="token" type="password" autoComplete="new-password"
                placeholder={sb.token ? t("已保存（尾号 {tail}），留空不修改", { tail: sb.token.slice(-4) }) : t("OMS 后台 → API 配置里的 Token")} />
            </label>
            <label className="f">{t("接口地址（一般不用改）")}
              <input name="baseUrl" defaultValue={sbSaved.baseUrl ?? ""} placeholder="https://oms.shipbest.com" autoComplete="off" />
            </label>
          </div>
        </FlashForm>
        <div className="row" style={{ marginTop: 8 }}>
          <FlashForm action={verifyAction} submitLabel="测试连接" submitClass="" inline />
          <FlashForm action={syncChannelsAction} submitLabel="同步渠道" inline />
        </div>
      </SettingsSection>

      {(() => {
        const site = { ...{ company: "", address: "", phone: "", wechat: "", email: "", hours: "" }, ...s.site };
        return (
          <SettingsSection
            id="site"
            title={t("官网与联系方式")}
            defaultOpen={!site.phone && !site.wechat && !site.email}
            badge={<span className={`badge ${site.phone || site.wechat || site.email ? "ok" : "pending"}`}>{site.phone || site.wechat || site.email ? t("已填写") : t("未填写")}</span>}
            summary={[site.company, site.phone, site.wechat, site.email].filter(Boolean).join(" · ")}
            actions={<a className="btn small" href="/site" target="_blank">{t("查看官网")}</a>}
          >
            <p className="small muted" style={{ marginTop: 0 }}>{t("客户 OMS 网址的首页就是官网：介绍服务、引导访客“联系我们”（不开放自助注册）和老客户登录。这里填的联系方式会显示在官网上，留空的不显示。官网上的品牌名称就是下面“客户端显示的公司名称”。")}</p>
            <FlashForm action={saveSiteAction} submitLabel="保存" review>
              <div className="grid" style={{ margin: "12px 0" }}>
                <label className="f">{t("公司名称")}<input name="company" defaultValue={site.company} maxLength={80} /></label>
                <label className="f">{t("地址")}<input name="address" defaultValue={site.address} maxLength={120} placeholder="Chino, CA 91710" /></label>
                <label className="f">{t("签约地址（服务条款用，官网不显示）")}<input name="contractAddress" defaultValue={site.contractAddress ?? ""} maxLength={160} placeholder="3134 Friendswood Ave, El Monte, CA 91733" /></label>
                <label className="f">{t("签约联系邮箱（服务条款用，官网不显示）")}<input name="contractEmail" type="email" defaultValue={site.contractEmail ?? ""} maxLength={80} placeholder="info@innotronia.com" /></label>
                <label className="f">{t("微信")}<input name="wechat" defaultValue={site.wechat} maxLength={40} /></label>
                <label className="f">{t("电话")}<input name="phone" defaultValue={site.phone} maxLength={40} /></label>
                <label className="f">{t("邮箱")}<input name="email" type="email" defaultValue={site.email} maxLength={80} /></label>
                <label className="f">{t("服务时间")}<input name="hours" defaultValue={site.hours} maxLength={80} /></label>
              </div>
            </FlashForm>
          </SettingsSection>
        );
      })()}

      {(() => {
        const jg = s.jiagu ?? { enabled: false, clientId: "", secret: "", ownershipId: "", customerId: "", warehouseId: "" };
        const ready = !!(jg.clientId && jg.secret && jg.ownershipId && jg.customerId);
        const jgChannels = listChannels().filter((c) => isJiaguCode(c.code));
        const jgWarehouse = (code: string) => {
          const pid = code.slice(JG_PREFIX.length);
          return jg.warehouses?.[pid] || DEFAULT_JG_WAREHOUSES[pid] || jg.warehouseId;
        };
        const jgMissing = jgChannels.filter((c) => !jgWarehouse(c.code));
        return (
          <SettingsSection
            id="jiagu"
            title={t("嘉谷万邑连接")}
            defaultOpen={jg.enabled && ready && jgMissing.length > 0}
            badge={<span className={`badge ${jg.enabled && ready ? "ok" : "pending"}`}>{jg.enabled && ready ? t("已启用") : ready ? t("已停用") : t("未配置")}</span>}
            summary={jgChannels.length ? t("{a} 个渠道，启用 {b} 个", { a: jgChannels.length, b: jgChannels.filter((c) => c.enabled).length }) : undefined}
          >
            <p className="small muted" style={{ marginTop: 0 }}>
              {t("第二个面单服务商（尾程订单）。启用后点上面的“同步渠道”，嘉谷的渠道会出现在渠道列表里，名称后面带“· GDE”（ShipBest 的带“· SB”），只有后台看得到；客户只看到物流商名称。模拟 / 沙盒 / 正式模式和 ShipBest 共用：沙盒模式下嘉谷也是真实报价、模拟出单。")}
            </p>
            {(() => {
              const missing = jgChannels.filter((c) => !jgWarehouse(c.code));
              return jg.enabled && ready && missing.length > 0 ? (
                <div className="alert warn">{t("以下渠道还没有仓库 ID，报价和下单会失败，请向嘉谷索取：{list}", { list: missing.map((c) => c.name.replace(JG_SUFFIX, "")).join("、") })}</div>
              ) : null;
            })()}
            <FlashForm action={saveJiaguAction} submitLabel="保存并测试连接" locked="修改后所有客户使用嘉谷渠道的报价和出单都会受影响" review>
              <div className="grid" style={{ margin: "12px 0" }}>
                <label className="f">{t("启用")}
                  <select name="enabled" defaultValue={jg.enabled ? "1" : "0"}>
                    <option value="1">{t("启用")}</option>
                    <option value="0">{t("停用")}</option>
                  </select>
                </label>
                <label className="f">Client ID
                  <input name="clientId" defaultValue={jg.clientId} autoComplete="off" />
                </label>
                <label className="f">Client Secret
                  <input name="secret" type="password" autoComplete="new-password"
                    placeholder={jg.secret ? t("已保存（尾号 {tail}），留空不修改", { tail: jg.secret.slice(-4) }) : ""} />
                </label>
                <label className="f">{t("权属 ID（OwnershipID）")}
                  <input name="ownershipId" defaultValue={jg.ownershipId} inputMode="numeric" autoComplete="off" />
                </label>
                <label className="f">{t("客户 ID（CustomerID）")}
                  <input name="customerId" defaultValue={jg.customerId} inputMode="numeric" autoComplete="off" />
                </label>
                <label className="f">{t("默认仓库 ID（WarehouseID）")}
                  <input name="warehouseId" defaultValue={jg.warehouseId} inputMode="numeric" autoComplete="off" placeholder={t("下面没单独填的渠道用这个")} />
                </label>
              </div>
              {jgChannels.length > 0 && (
                <div className="table-wrap" style={{ marginBottom: 12 }}>
                  <table className="list">
                    <thead><tr><th>{t("嘉谷渠道")}</th><th>{t("产品 ID")}</th><th>{t("仓库 ID")}</th></tr></thead>
                    <tbody>
                      {jgChannels.map((c) => {
                        const pid = c.code.slice(JG_PREFIX.length);
                        return (
                          <tr key={c.code} className={c.enabled ? "" : "muted"}>
                            <td>{c.name.replace(JG_SUFFIX, "")}{!c.enabled && <span className="badge pending" style={{ marginLeft: 6 }}>{t("已停用")}</span>}</td>
                            <td className="small muted">{pid}</td>
                            <td><input name={`wh_${pid}`} defaultValue={jg.warehouses?.[pid] ?? DEFAULT_JG_WAREHOUSES[pid] ?? ""} inputMode="numeric" autoComplete="off" style={{ width: 120 }} placeholder={jg.warehouseId || t("未填写")} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="small muted" style={{ margin: "6px 0 0" }}>{t("渠道的启用 / 停用在下面“物流渠道”里统一设置。")} <a href="#channels">{t("去设置 ↓")}</a></p>
                </div>
              )}
            </FlashForm>
            <div className="row" style={{ marginTop: 8 }}>
              <FlashForm action={testJiaguAction} submitLabel="测试连接 / 查余额" submitClass="" inline />
            </div>
          </SettingsSection>
        );
      })()}

      {(() => {
        const ac = addrConfig();
        const saved = s.addrCheck ?? { enabled: true, provider: "google", googleKey: "", monthlyCap: 5000 };
        const us = s.usps ?? { enabled: true, consumerKey: "", consumerSecret: "" };
        const used = monthlyUsage(ac.provider);
        return (
          <SettingsSection
            id="addr"
            title={t("收件地址核对")}
            badge={<span className={`badge ${ac.enabled ? "ok" : "pending"}`}>{ac.enabled ? t("已启用") : ac.configured ? t("已停用") : t("未配置")}</span>}
            summary={ac.monthlyCap > 0 ? t("本月已用 {a} / {b} 次", { a: used, b: ac.monthlyCap }) : undefined}
          >
            <p className="small muted">
              {t("客户查运费时自动核对收件地址：地址不存在或缺公寓号会提醒客户，必须确认后才能下单；写法不标准会给出建议地址。同一个地址只查一次，以后直接用上次的结果。")}
            </p>
            {ac.monthlyCap > 0 && (
              <div className="usage-bar" title={t("本月已用 {a} / {b} 次", { a: used, b: ac.monthlyCap })}>
                <span className="small">{t("本月已用 {a} / {b} 次", { a: used, b: ac.monthlyCap })}{used >= ac.monthlyCap ? ` · ${t("已到上限，本月暂停核对")}` : ""}</span>
                <div><i style={{ width: `${Math.min(100, (used / ac.monthlyCap) * 100)}%` }} className={used >= ac.monthlyCap ? "full" : ""} /></div>
              </div>
            )}
            <FlashForm action={saveAddrCheckAction} submitLabel="保存并测试连接" locked="修改后所有客户下单都会用新的设置核对地址">
              <div className="grid" style={{ margin: "12px 0" }}>
                <label className="f">{t("服务商")}
                  <select name="provider" defaultValue={saved.provider}>
                    <option value="google">{t("Google（每月前 5000 次免费）")}</option>
                    <option value="usps">{t("USPS（需签约，按月收费）")}</option>
                  </select>
                </label>
                <label className="f">Google API Key
                  <input name="googleKey" type="password" autoComplete="new-password"
                    placeholder={ac.googleKey ? t("已保存（尾号 {tail}），留空不修改", { tail: ac.googleKey.slice(-4) }) : t("Google Cloud → 凭据里的 API 密钥")} />
                </label>
                <label className="f">{t("每月最多查询次数")}
                  <input name="monthlyCap" type="number" min={0} step={100} defaultValue={saved.monthlyCap} />
                  <span className="field-hint muted">{t("到了上限本月就不再查，不会产生费用；0 = 不限制")}</span>
                </label>
                <label className="f" style={{ alignSelf: "end" }}>
                  <span><input type="checkbox" name="enabled" defaultChecked={saved.enabled !== false} /> {t("启用地址核对")}</span>
                </label>
              </div>
              <details className="small" style={{ marginBottom: 10 }}>
                <summary>{t("USPS 账号（选 USPS 时才用）")}</summary>
                <div className="grid" style={{ marginTop: 8 }}>
                  <label className="f">Consumer Key
                    <input name="consumerKey" defaultValue={us.consumerKey} autoComplete="off" />
                  </label>
                  <label className="f">Consumer Secret
                    <input name="consumerSecret" type="password" autoComplete="new-password"
                      placeholder={ac.usps.consumerSecret ? t("已保存（尾号 {tail}），留空不修改", { tail: ac.usps.consumerSecret.slice(-4) }) : ""} />
                  </label>
                </div>
              </details>
            </FlashForm>
            {ac.configured && (
              <div className="row" style={{ marginTop: 8 }}>
                <FlashForm action={testAddrAction} submitLabel="测试连接" submitClass="" inline />
              </div>
            )}
          </SettingsSection>
        );
      })()}

      {(() => {
        const sm = smtpConfig();
        const saved = s.smtp ?? { host: "", port: 465, user: "", pass: "", from: "" };
        const logs = recentEmailLog(8);
        return (
          <SettingsSection
            id="mail"
            title={t("邮件通知")}
            defaultOpen={!(sm.host && sm.from)}
            badge={<span className={`badge ${sm.host && sm.from && s.notifyEnabled !== false ? "ok" : "pending"}`}>{sm.host && sm.from ? (s.notifyEnabled !== false ? t("已启用") : t("已停用")) : t("未配置")}</span>}
            summary={sm.from || undefined}
          >
            <p className="small muted">
              {t("配置发件邮箱后，系统会给客户发这些通知（中英双语）：")}{NOTIFY_EVENTS.map((e) => t(NOTIFY_LABEL[e])).join(t("、"))}{t("。客户可以在“账户设置 → 邮件通知”里逐项关闭，每封邮件也有退订链接。忘记密码的重置邮件也用这个邮箱发。")}
            </p>
            <FlashForm action={saveSmtpAction} submitLabel="保存" locked="修改后所有邮件都用新的发件设置">
              <div className="grid" style={{ margin: "12px 0" }}>
                <label className="f">{t("SMTP 服务器")}<input name="host" defaultValue={saved.host} placeholder="smtp.gmail.com" autoComplete="off" /></label>
                <label className="f">{t("端口")}<input name="port" type="number" defaultValue={saved.port || 465} /></label>
                <label className="f">{t("用户名")}<input name="user" defaultValue={saved.user} placeholder="info@innotronia.com" autoComplete="off" /></label>
                <label className="f">{t("密码 / 应用专用密码")}<input name="pass" type="password" autoComplete="new-password" placeholder={saved.pass ? t("已保存，留空不修改") : ""} /></label>
                <label className="f">{t("发件人")}<input name="from" defaultValue={saved.from} placeholder={`${s.brandName} <info@innotronia.com>`} /></label>
                <label className="f" style={{ alignSelf: "end" }}><span><input type="checkbox" name="notifyEnabled" defaultChecked={s.notifyEnabled !== false} /> {t("发送客户通知")}</span></label>
              </div>
            </FlashForm>
            {sm.host && sm.from && (
              <FlashForm action={testMailAction} submitLabel="发送测试邮件" submitClass="" className="row" >
                <input name="to" type="email" placeholder={t("收件邮箱")} required style={{ maxWidth: 260 }} />
              </FlashForm>
            )}
            {logs.length > 0 && (
              <details className="small" style={{ marginTop: 10 }}>
                <summary>{t("最近发送记录")}</summary>
                <table className="list" style={{ marginTop: 6 }}>
                  <tbody>
                    {logs.map((l) => (
                      <tr key={l.id}>
                        <td className="muted">{fmtTime(l.created_at)}</td>
                        <td>{l.customer_name}</td>
                        <td>{l.to_email}</td>
                        <td className="wrap">{l.subject}</td>
                        <td><span className={`badge ${l.status === "sent" ? "ok" : "exception"}`}>{l.status === "sent" ? t("已发送") : t("失败")}</span>{l.error && <div className="small muted">{l.error}</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </SettingsSection>
        );
      })()}

      {(() => {
        const terms = getTerms();
        return (
          <SettingsSection
            id="terms"
            title={t("客户服务条款")}
            badge={<span className="badge ok">{t("第 {v} 版", { v: terms.version })}</span>}
            summary={t("{n} 位客户已签署当前版本", { n: acceptedCount() })}
          >
            <p className="small muted" style={{ marginTop: 0 }}>
              {t("客户第一次登录客户中心时，必须填写签署人、勾选同意这份条款才能使用；系统会存档签署时的客户信息和条款原文，在客户详情里可以查看。")}
              {t("可以用的占位：{company} 我们的公司名称、{companyAddress} 公司地址、{companyEmail} 公司联系邮箱（都来自“官网与联系方式”）、{brand} 平台名称、{customer} 客户名称、{address} 客户地址、{contactLine} 联系人及职位、{phone} 电话、{email} 邮箱、{cancelHours} 可取消小时数、{signer} {signerTitle} {signDate} 签署人、职位、签署日期，签署时自动换成实际内容。")}
            </p>
            <div className={`alert ${usingDefaultTerms() ? "ok" : "warn"} small`} style={{ marginBottom: 8 }}>
              {usingDefaultTerms()
                ? t("现在用的是系统默认条款（正式合同格式），系统更新条款后会自动用最新版。")
                : t("现在用的是你修改过的自定义条款，系统默认条款更新后不会自动替换。需要用最新的系统默认条款，请点下面的“恢复系统默认条款”。")}
            </div>
            {!usingDefaultTerms() && (
              <FlashForm action={resetTermsAction} submitLabel="恢复系统默认条款" submitClass="small" confirm="用最新的系统默认条款替换现在的自定义条款？" className="row" >
                <label className="small"><input type="checkbox" name="bump" defaultChecked /> {t("同时要求所有客户重新签署（版本号 +1）")}</label>
                <input name="changeNote" maxLength={500} defaultValue={t("服务条款更新为正式协议格式，签约主体为 Atronia Innovations Inc.")} style={{ flex: 1, minWidth: 240 }} />
              </FlashForm>
            )}
            <FlashForm action={saveTermsAction} submitLabel="保存条款" locked="修改后客户看到的服务条款会变化">
              <div className="grid2" style={{ margin: "12px 0" }}>
                <label className="f">{t("中文条款")}<textarea name="zh" rows={16} defaultValue={terms.zh} /></label>
                <label className="f">{t("英文条款（客户端切换英文时显示）")}<textarea name="en" rows={16} defaultValue={terms.en} /></label>
              </div>
              <label className="small" style={{ display: "block", marginBottom: 8 }}>
                <input type="checkbox" name="bump" /> {t("这是重要修改：要求所有客户重新签署（版本号 +1）")}
              </label>
              <label className="f" style={{ marginBottom: 10 }}>{t("修改说明（选填，重要修改时显示在客户的签署页顶部）")}
                <input name="changeNote" maxLength={500} placeholder={t("例如：补差规则调整为按承运商账单实际金额收取")} />
              </label>
            </FlashForm>
            <p className="small" style={{ marginTop: 12 }}>
              <a href="/api/terms/export">{t("下载全部客户的签署存档（ZIP）")}</a>
              <span className="muted"> · {t("每份签署都自动存档（协议原文、签署人、时间、IP），客户资料或条款以后修改也不会影响已签的存档；服务器每天自动备份。")}</span>
            </p>
            {(() => {
              const unsigned = unsignedCustomers();
              return unsigned.length ? (
                <details style={{ marginTop: 12 }}>
                  <summary className="small">{t("还没签署当前版本的客户（{n}）", { n: unsigned.length })}</summary>
                  <p className="small muted">{t("这些客户下次登录客户中心时会被要求签署。")}</p>
                  <table className="list">
                    <tbody>
                      {unsigned.map((c) => (
                        <tr key={c.id}>
                          <td><a href={`/customers/${c.id}`}>{c.name}</a></td>
                          <td className="small muted">{c.email}</td>
                          <td className="small">{c.signedVersion ? t("签过第 {v} 版", { v: c.signedVersion }) : t("从未签署")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ) : null;
            })()}
          </SettingsSection>
        );
      })()}

      <SettingsSection
        id="finance-pin"
        title={t("财务确认密码")}
        defaultOpen={!hasFinancePin()}
        badge={<span className={`badge ${hasFinancePin() ? "ok" : "pending"}`}>{hasFinancePin() ? t("已设置") : t("未设置")}</span>}
      >
        <p className="small muted">{t("确认客户充值到账、手动充值 / 调账时，要再输入这个 4 位数字密码。设置和修改都需要管理员登录密码；连续输错 5 次锁定 30 分钟。")}</p>
        <FlashForm action={setFinancePinAction} submitLabel={hasFinancePin() ? "修改财务确认密码" : "设置财务确认密码"} resetOnSuccess>
          <div className="grid" style={{ margin: "12px 0" }}>
            <label className="f"><span className="req">{t("管理员登录密码")}</span><input name="adminPassword" type="password" required autoComplete="current-password" /></label>
            <label className="f"><span className="req">{t("新的 4 位数字密码")}</span><input name="pin" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="new-password" /></label>
            <label className="f"><span className="req">{t("再输一次")}</span><input name="pin2" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="new-password" /></label>
          </div>
        </FlashForm>
      </SettingsSection>

      <SettingsSection
        id="rules"
        title={t("全局加价规则")}
        summary={t("+{pct}% + {fixed}，最低利润 {min}", { pct: s.markup.percent, fixed: money(s.markup.fixed), min: money(s.markup.minProfit) }) + ` · ${t("下单后可取消时限（小时）")} ${s.cancelWindowHours ?? 48}`}
      >
      <FlashForm action={saveSettingsAction} submitLabel="保存设置" locked="修改会影响所有客户的价格和余额规则" confirm="加价、取消费、补差和余额规则会对所有客户生效，确定保存吗？">
        <p className="small muted">
          {t("客户价 = max(成本 × (1 + 加价%) + 固定加价, 成本 + 最低利润)，再按取整步长向上取整。")}
          {t("优先级：客户专属设置 > 渠道设置 > 全局默认（按字段逐项覆盖）。成本 = ShipBest 试算的“优惠后总运费”。")}
        </p>
        <div className="grid">
          <RuleInputs value={s.markup} />
          <label className="f">{t("取整步长")}
            <select name="roundingStep" defaultValue={String(s.roundingStep)}>
              <option value="0.01">{t("0.01（不取整）")}</option>
              <option value="0.05">0.05</option>
              <option value="0.1">0.10</option>
              <option value="0.5">0.50</option>
              <option value="1">1.00</option>
            </select>
          </label>
        </div>
        <p className="small muted">
          {t("示例：")}{example.map((c) => t("成本 {cost} → 客户价 {price}", { cost: money(c), price: money(computePrice(c, s.markup, s.roundingStep)) })).join(t("；"))}
        </p>
        <p className="small muted">{t("加价按这个顺序取第一个设置了的：客户在该渠道的专属加价（客户页面“按渠道加价”）→ 客户专属加价 → 渠道加价（下面“物流渠道”表格）→ 这里的全局默认。每张订单都会记下下单时用的比例，面单记录里可以看到。")}</p>
        {(() => {
          const log = listMarkupLog({ limit: 50 });
          return log.length ? (
            <details style={{ margin: "8px 0 12px" }}>
              <summary className="small"><b>{t("加价修改记录（最近 {n} 条）", { n: log.length })}</b></summary>
              <table className="list" style={{ marginTop: 8 }}>
                <tbody>
                  {log.map((l) => (
                    <tr key={l.id}>
                      <td className="small muted" style={{ whiteSpace: "nowrap" }}>{fmtTime(l.createdAt)}</td>
                      <td className="small">{t(MARKUP_SCOPE_LABEL[l.scope])}</td>
                      <td className="small">{l.label}</td>
                      <td className="small">{describeRule(l.before)} → <b>{describeRule(l.after)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null;
        })()}

        <h3>{t("取消订单")}</h3>
        <div className="grid">
          <label className="f">{t("下单后可取消时限（小时）")}<input name="cancelWindowHours" type="number" step="1" min="0" defaultValue={s.cancelWindowHours ?? 48} placeholder={t("0 = 不限")} /></label>
          <label className="f">{t("向客户收取手续费 %")}<input name="cancelFeePercent" type="number" step="0.01" defaultValue={s.cancelFeePercent} /></label>
          <label className="f">{t("ShipBest 收取取消费 %")}<input name="sbCancelFeePercent" type="number" step="0.01" defaultValue={s.sbCancelFeePercent} /></label>
        </div>
        <p className="small muted">{t("客户取消费按客户价计算，ShipBest 取消费按我们的成本计算；只有已出面单的订单才收取。确认取消时可以手动修改。")} {t("超过可取消时限后，客户端不再显示“申请取消”；后台仍可操作（特殊情况和服务商沟通后使用）。")}</p>

        <h3>{t("官方账单补差（多退少补）")}</h3>
        <div className="grid">
          <label className="f" style={{ gridColumn: "span 2" }}>{t("补差如何转嫁给客户")}
            <select name="adjustmentPolicy" defaultValue={s.adjustmentPolicy}>
              {Object.entries(ADJUSTMENT_POLICY_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </select>
          </label>
        </div>
        <p className="small muted">{t("ShipBest 扣的是预报价，官方账单出来后按重量或分区差异多退少补。在“补差导入”上传他们的表格时，按这里的规则计算向客户补收或退还的金额（导入时的规则会记录在批次上）。")}</p>

        <h3>{t("客户余额与充值")}</h3>
        <div className="grid">
          <label className="f" style={{ gridColumn: "span 2" }}>{t("下单余额规则")}
            <select name="balanceRule" defaultValue={s.balanceRule}>
              {Object.entries(BALANCE_RULE_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </select>
          </label>
        </div>
        <p className="small muted">{t("月结客户可以在客户页面设置信用额度：可用余额 = 余额 + 信用额度。后台代客户下单也按这个规则检查。收款方式在下方“收款方式”里设置。")}</p>

        <h3>{t("客户端")}</h3>
        <div className="grid">
          <label className="f">{t("客户端显示的公司名称")}<input name="brandName" defaultValue={s.brandName} maxLength={60} /></label>
          <label className="f" style={{ gridColumn: "span 2" }}>{t("客服联系方式（显示在客户端）")}<input name="supportContact" defaultValue={s.supportContact} maxLength={200} placeholder={t("例如：微信 xxx / 邮箱 support@xxx.com")} /></label>
        </div>
        <p className="small muted">{t("客户登录地址：")}<code>/portal</code>{t("。在“客户”页面给客户开通登录。")}</p>

        <h3>{t("默认值")}</h3>
        <div className="grid">
          <label className="f">{t("默认单位")}
            <select name="defaultUnit" defaultValue={String(s.defaultUnit)}>
              <option value="3">{t("lb / in（英制）")}</option>
              <option value="2">kg / cm</option>
              <option value="1">g / cm</option>
            </select>
          </label>
          <label className="f">{t("默认币种")}<input name="defaultCurrency" defaultValue={s.defaultCurrency} maxLength={3} /></label>
        </div>

        <div style={{ height: 12 }} />
      </FlashForm>
      </SettingsSection>

      {/* 收款设置和“立即更新汇率”是两个表单（不能嵌套），放在同一张卡片里 */}
      <SettingsSection
        id="payment"
        className="pay-card"
        title={t("收款方式（客户充值）")}
        defaultOpen={!s.zelleInfo && !s.alipayInfo}
        badge={<span className={`badge ${s.zelleInfo || s.alipayInfo ? "ok" : "pending"}`}>{s.zelleInfo || s.alipayInfo ? t("已设置") : t("未设置")}</span>}
        summary={[s.zelleInfo && "Zelle", s.alipayInfo && t("支付宝"), `${t("当前汇率")} ${fx.rate}`].filter(Boolean).join(" · ")}
      >
        <FlashForm action={savePaymentSettingsAction} submitLabel="保存收款设置" locked="客户充值页会显示这里的收款账号" confirm="客户会按这里的信息付款，请再核对一遍收款账号。确定保存吗？">
          <p className="small muted">{t("客户在客户端“充值”页选择 Zelle（美元）或支付宝（人民币）付款，上传凭证后提交申请；你们在“财务”页确认到账后自动加到客户余额。余额以美元记账。")}</p>
          <div className="grid2">
            <label className="f">{t("Zelle 收款信息（显示给客户）")}
              <textarea name="zelleInfo" rows={3} defaultValue={s.zelleInfo} placeholder={t("邮箱 / 电话：pay@example.com\n户名：Atronia Innovations Inc.")} />
            </label>
            <label className="f">{t("支付宝收款信息（显示给客户）")}
              <textarea name="alipayInfo" rows={3} defaultValue={s.alipayInfo} placeholder={t("支付宝账号：xxx@xxx.com\n户名：某某")} />
            </label>
          </div>
          <div className="grid2" style={{ marginTop: 10 }}>
            {([
              ["zelle", "Zelle 收款码图片（银行 App 扫码付款，PNG / JPG，可选）", "Zelle 收款码", !!s.zelleQr],
              ["alipay", "支付宝收款码图片（PNG / JPG，可选）", "支付宝收款码", s.alipayQr],
            ] as const).map(([kind, label, alt, has]) => (
              <div key={kind} className="row" style={{ alignItems: "flex-start", gap: 10 }}>
                <label className="f" style={{ flex: 1 }}>{t(label)}{has ? t("：已上传，重新选择可替换") : ""}
                  <FilePick name={`${kind}Qr`} accept=".png,.jpg,.jpeg" />
                  {has && <span className="small"><input type="checkbox" name={`${kind}QrRemove`} /> {t("删除这张收款码")}</span>}
                </label>
                {has && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/assets/${kind}-qr`} alt={t(alt)} style={{ width: 110, height: 110, objectFit: "contain", border: "1px solid var(--line)", borderRadius: 6, background: "#fff" }} />
                )}
              </div>
            ))}
          </div>
          <h3>{t("人民币汇率")}</h3>
          <div className="grid">
            <label className="f">{t("汇率来源")}
              <select name="fxMode" defaultValue={s.fxMode}>
                <option value="auto">{t("当天实时汇率 + 加点（推荐）")}</option>
                <option value="manual">{t("固定汇率 + 加点")}</option>
              </select>
            </label>
            <label className="f">{t("实时汇率更新频率")}
              <select name="fxRefresh" defaultValue={s.fxRefresh ?? "daily"}>
                <option value="daily">{t("每天一次（全天固定，推荐）")}</option>
                <option value="hourly">{t("每小时")}</option>
              </select>
            </label>
            <label className="f">{t("加点（加在汇率上，例如 0.03）")}<input name="fxMarkup" type="number" step="0.001" min="0" max="1" defaultValue={s.fxMarkup} /></label>
            <label className="f">{t("固定 / 备用汇率")}<input name="fxManualRate" type="number" step="0.0001" defaultValue={s.fxManualRate} /></label>
          </div>
          <p className="small">
            {t("当前：")}{fx.manual ? `${fxSource} ${fx.live}` : t("实时汇率 {live}（{source}）", { live: fx.live, source: fxSource + (fx.fetchedAt ? t("，取于 {time}", { time: fmtTime(fx.fetchedAt) }) : "") })}
            {" "}{t("+ 加点 {m} =", { m: fx.markup })} <b>{t("充值汇率 {rate}", { rate: fx.rate })}</b>{t("（充 100 美元需付 ¥{cny}）", { cny: cnyToPay(100, fx.rate).toFixed(2) })}
          </p>
          <p className="small muted">
            {t("自动更新，不需要手动操作：选“每天一次”时，每天（美西时间）第一次有人打开充值页时取当天的实时汇率，当天之内固定不变；选“每小时”则每小时更新一次。")}
            {t("来源 ExchangeRate-API，备用欧洲央行数据；获取失败时用最近一次的汇率，再不行用上面的备用汇率。点“立即更新汇率”可以马上重新获取今天的汇率。")}
          </p>
          <label className="f" style={{ margin: "8px 0 12px" }}>{t("充值页其他说明（可选）")}
            <textarea name="topupInstructions" rows={2} defaultValue={s.topupInstructions} placeholder={t("例如：转账备注请写公司名；工作日 2 小时内确认到账")} />
          </label>
        </FlashForm>
        <div className="fx-refresh">
          <span className="small muted">{t("当前汇率")} <b>{fx.rate}</b></span>
          <FlashForm action={refreshFxAction} submitLabel="立即更新汇率" submitClass="small" inline />
        </div>
      </SettingsSection>

      <SettingsSection
        id="stamp"
        title={t("面单加印 SKU")}
        summary={[s.stamp.autoDetect !== false ? t("自动检查面单是否已有 SKU") : "", s.stamp.enabled ? t("所有渠道默认加印") : ""].filter(Boolean).join(" · ") || undefined}
      >
        <StampSettings embedded global={s.stamp} detect={labelSkuStats()} channels={channels.filter((c) => c.enabled).map((c) => ({ code: c.code, name: c.name, stamp: c.stamp }))} />
      </SettingsSection>

      <SettingsSection
        id="channels"
        title={t("物流渠道")}
        defaultOpen={channels.length === 0}
        summary={t("启用 {a} / 共 {b} 个渠道", { a: channels.filter((c) => c.enabled).length, b: channels.length })}
      >
      <FlashForm action={saveChannelsAction} submitLabel="保存渠道设置" locked="开关渠道、改渠道加价会影响所有客户" confirm="渠道设置会对所有客户生效，确定保存吗？">
        <p className="small muted">{t("这里是总开关：取消勾选的渠道所有客户都不能用。每个客户具体能用哪些渠道，在“客户”详情里单独开通（新客户默认不开通）。加价留空 = 沿用全局设置。")}</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{t("启用")}</th><th>{t("渠道")}</th><th>{t("客户看到的名称 / 物流商")}</th><th>{t("加价 %")}</th><th>{t("固定加价")}</th><th>{t("最低利润")}</th><th>{t("成本 10.00 时客户价")}</th><th className="num">{t("开通客户")}</th></tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.code}>
                  <td><input type="checkbox" name={`enabled.${c.code}`} defaultChecked={c.enabled} /></td>
                  <td>{c.name}<div className="small muted">{c.code}</div></td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <CarrierMark carrier={publicChannel(c).carrier} size="sm" />
                      <input name={`display.${c.code}`} defaultValue={c.displayName ?? ""} placeholder={defaultPublicName(c.name, c.carrier)} maxLength={40} style={{ width: 150 }} />
                    </div>
                    <select name={`carrier.${c.code}`} defaultValue={c.carrier ?? ""} style={{ marginTop: 6, width: 190 }}>
                      <option value="">{t("自动识别：{name}", { name: carrierById(guessCarrier(c.name)).name })}</option>
                      {CARRIERS.map((x) => <option key={x.id} value={x.id}>{t(x.name)}</option>)}
                    </select>
                  </td>
                  <RuleCells prefix={`${c.code}.`} value={c.markup} global={s.markup} t={t} />
                  <td>{money(computePrice(10, resolveRule(s.markup, c.markup), s.roundingStep))}</td>
                  <td className="num">{opened[c.code] ?? 0}</td>
                </tr>
              ))}
              {!channels.length && <tr><td colSpan={8} className="muted">{t("还没有渠道，请点上方“同步渠道”")}</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ height: 12 }} />
      </FlashForm>
      </SettingsSection>

      {(() => {
        const list = channels.filter((c) => c.enabled);
        const fields = [["maxLb", "最大计费重 (lb)"], ["maxLongestIn", "最长边 (in)"], ["maxSumIn", "长宽高之和 (in)"], ["maxGirthIn", "长 + 周长 (in)"], ["divisor", "材积系数"], ["minLongestIn", "最小最长边 (in)"], ["minSecondIn", "最小第二长边 (in)"]] as const;
        const limited = list.filter((c) => limitsFor(c.code)).length;
        return (
          <SettingsSection id="limits" title={t("渠道重量 / 尺寸限制")} summary={t("{n} 个渠道有限制", { n: limited })}>
            <p className="small muted" style={{ marginTop: 0 }}>{t("报价前先检查包裹：超出限制的，这个渠道直接不报价（客户看到“不支持该重量或地区 / 超出尺寸范围”），免得出单后被服务商拒收或补收。计费重 = 实重和体积重取大，体积重 = 长×宽×高（英寸）÷ 材积系数。留空 = 不检查这一项。最小尺寸只提醒、不拦单，留空按 15 × 10 cm 提醒，填 0 = 不提醒。灰字是默认值（来自嘉谷万邑 2026.9.24 渠道说明和 ShipBest 2026.8 报价表，只填了超过就拒收的最大限制；附加费接口报价里会算）。")}</p>
            <FlashForm action={saveChannelLimitsAction} submitLabel="保存限制" review>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t("渠道")}</th>{fields.map(([, l]) => <th key={l}>{t(l)}</th>)}<th>{t("恢复默认")}</th></tr></thead>
                  <tbody>
                    {list.map((c) => {
                      const saved = savedLimits(c.code);
                      const def = defaultLimits(c.code, c.name);
                      const v = (x: number | null | undefined) => (x === null || x === undefined ? "" : String(x));
                      return (
                        <tr key={c.code}>
                          <td className="small">{c.name}<div className="muted">{saved ? t("已自定义") : def ? t("默认") : t("不限制")}</div></td>
                          {fields.map(([k]) => (
                            <td key={k}><input name={`${c.code}.${k}`} type="number" step="0.1" min="0" defaultValue={saved ? v(saved[k]) : v(def?.[k])} placeholder={v(def?.[k] ?? (k in DEFAULT_MIN ? DEFAULT_MIN[k as keyof typeof DEFAULT_MIN] : undefined))} style={{ width: 90 }} /></td>
                          ))}
                          <td>{saved && def ? <input type="checkbox" name={`${c.code}.reset`} aria-label={t("恢复默认")} /> : null}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </FlashForm>
          </SettingsSection>
        );
      })()}

      {isSandboxSite() && (
        <SettingsSection id="sandbox-reset" className="danger-card" title={t("清空沙盒数据")} summary={t("沙盒站的测试数据可以随时清空，不影响正式站")}>
          <p className="small muted">{t("删除沙盒站里的全部订单、扣款退款流水、充值、批量导入、补差、签署记录、服务商日志和面单文件；客户账号、渠道、价格和设置保留，可以马上接着测试。正式站的数据完全不受影响。")}</p>
          <FlashForm action={resetSandboxAction} submitLabel="清空沙盒数据" submitClass="danger" confirm="确定清空沙盒站的全部测试数据吗？">
            <label className="f" style={{ maxWidth: 320, marginBottom: 10 }}>{t("输入“清空沙盒”确认")}
              <input name="confirm" autoComplete="off" placeholder={lang === "en" ? "RESET" : "清空沙盒"} />
            </label>
          </FlashForm>
        </SettingsSection>
      )}

      {currentEnv() === "live" && (() => {
        const st = testDataStats();
        return (
          <SettingsSection
            id="cleanup"
            className="danger-card"
            title={t("清除模拟 / 沙盒数据")}
            summary={hasTestData(st) ? t("可清除模拟 / 沙盒订单 {n}", { n: st.testShipments }) : t("没有需要清除的模拟 / 沙盒数据。")}
          >
            <p className="small muted">
              {t("只删除模拟、沙盒模式下的订单，以及这些订单的扣款、退款、补差、批量导入记录和面单文件；真实订单和它们的账目不会动，上线后也可以随时用。充值和手动调账分不出是不是测试，会保留，如有测试充值请在客户页面手动调整。清除前会自动备份。")}
            </p>
            <p className="small muted">
              {t("内部测试账号（客户页面里标记的）下的模拟单也在这里一起清除。")}
            </p>
            <p className="small">
              {t("正式订单 {a}；可清除：模拟 / 沙盒订单 {b}、相关流水 {c}、补差 {d}、批量导入 {e}", {
                a: st.liveShipments, b: st.testShipments, c: st.testLedger, d: st.testAdjustments, e: st.testBatches,
              })}
            </p>
            {!hasTestData(st) ? (
              <div className="alert ok">{t("没有需要清除的模拟 / 沙盒数据。")}</div>
            ) : (
              <FlashForm action={clearTestDataAction} submitLabel="清除测试数据" submitClass="danger" confirm="确定清除模拟 / 沙盒数据吗？真实订单不受影响（会自动备份）。">
                <label className="f" style={{ maxWidth: 320, marginBottom: 10 }}>{t("输入“清除测试数据”确认")}
                  <input name="confirm" autoComplete="off" placeholder={lang === "en" ? "CLEAR" : "清除测试数据"} />
                </label>
              </FlashForm>
            )}
          </SettingsSection>
        );
      })()}
    </>
  );
}

function RuleCells({ prefix, value, global, t }: { prefix: string; value: Record<string, number | null | undefined>; global: MarkupRule; t: T }) {
  const v = (x: number | null | undefined) => (x === null || x === undefined ? "" : String(x));
  return (
    <>
      {(["percent", "fixed", "minProfit"] as const).map((k) => (
        <td key={k}>
          <input name={prefix + k} type="number" step="0.01" defaultValue={v(value[k])} placeholder={t("默认 {v}", { v: global[k] })} style={{ width: 110 }} />
        </td>
      ))}
    </>
  );
}
