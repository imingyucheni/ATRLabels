import { fmtTime } from "@/lib/time";
import { ADJUSTMENT_POLICY_LABEL, channelCustomerCounts, getSettings, listChannels } from "@/lib/db";
import { BALANCE_RULE_LABEL } from "@/lib/ledger";
import { computePrice, money, resolveRule, type MarkupRule } from "@/lib/pricing";
import { isSandboxSite, shipbestConfig, type ShipBestMode } from "@/lib/shipbest/client";
import StampSettings from "@/components/StampSettings";
import FlashForm from "@/components/FlashForm";
import RuleInputs from "@/components/RuleInputs";
import { setFinancePinAction, clearTestDataAction, saveAddrCheckAction, testAddrAction, refreshFxAction, saveChannelsAction, savePaymentSettingsAction, saveSettingsAction, saveShipBestAction, syncChannelsAction, verifyAction } from "@/app/actions";
import { cnyToPay, usdCnyQuote } from "@/lib/fx";
import FilePick from "@/components/FilePick";
import { CarrierMark } from "@/components/ChannelLabel";
import { CARRIERS, carrierById, defaultPublicName, guessCarrier, publicChannel } from "@/lib/carriers";
import { testDataStats } from "@/lib/cleanup";
import { addrConfig, monthlyUsage } from "@/lib/addressCheck";
import { hasFinancePin } from "@/lib/financePin";
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
      <h1>{t("设置")}</h1>

      <div className="card" id="shipbest">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{t("ShipBest 连接")}</h2>
          {sb.mode !== "mock" && (!sb.apiId || !sb.token) ? (
            // 正式 / 沙盒模式但没填 API 账号：接口调不通，不能显示成“正常”的绿色
            <span className="badge exception">{t(sb.mode === "live" ? "正式模式 · 未填写 API 账号" : "沙盒模式 · 未填写 API 账号")}</span>
          ) : (
            <span className={`badge ${sb.mode === "live" ? "ok" : sb.mode === "sandbox" ? "test" : "pending"}`}>{t(MODE_BADGE[sb.mode])}</span>
          )}
        </div>
        {isSandboxSite() && (
          <div className="alert warn" style={{ marginTop: 12 }}>{t("这里是沙盒站：数据和正式站分开，永远不会真实出单。选“正式”也会按沙盒处理。")}</div>
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
            <label className="f">{t("模式")}
              <select name="mode" defaultValue={sbSaved.mode === "env" ? sb.mode : sbSaved.mode}>
                <option value="mock">{t("模拟（不连 ShipBest，按报价表估算）")}</option>
                <option value="sandbox">{t("沙盒（真实报价，模拟出单，不扣费）")}</option>
                <option value="live" disabled={isSandboxSite()}>{t("正式（真实报价、真实出单扣费）")}{isSandboxSite() ? t("（沙盒站不可用）") : ""}</option>
              </select>
            </label>
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
      </div>

      {(() => {
        const ac = addrConfig();
        const saved = s.addrCheck ?? { enabled: true, provider: "google", googleKey: "", monthlyCap: 5000 };
        const us = s.usps ?? { enabled: true, consumerKey: "", consumerSecret: "" };
        const used = monthlyUsage(ac.provider);
        return (
          <div className="card" id="addr">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>{t("收件地址核对")}</h2>
              <span className={`badge ${ac.enabled ? "ok" : "pending"}`}>{ac.enabled ? t("已启用") : ac.configured ? t("已停用") : t("未配置")}</span>
            </div>
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
          </div>
        );
      })()}

      <div className="card" id="finance-pin">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{t("财务确认密码")}</h2>
          <span className={`badge ${hasFinancePin() ? "ok" : "pending"}`}>{hasFinancePin() ? t("已设置") : t("未设置")}</span>
        </div>
        <p className="small muted">{t("确认客户充值到账、手动充值 / 调账时，要再输入这个 4 位数字密码。设置和修改都需要管理员登录密码；连续输错 5 次锁定 30 分钟。")}</p>
        <FlashForm action={setFinancePinAction} submitLabel={hasFinancePin() ? "修改财务确认密码" : "设置财务确认密码"} resetOnSuccess>
          <div className="grid" style={{ margin: "12px 0" }}>
            <label className="f"><span className="req">{t("管理员登录密码")}</span><input name="adminPassword" type="password" required autoComplete="current-password" /></label>
            <label className="f"><span className="req">{t("新的 4 位数字密码")}</span><input name="pin" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="new-password" /></label>
            <label className="f"><span className="req">{t("再输一次")}</span><input name="pin2" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="new-password" /></label>
          </div>
        </FlashForm>
      </div>

      <FlashForm action={saveSettingsAction} submitLabel="保存设置" className="card" locked="修改会影响所有客户的价格和余额规则" confirm="加价、取消费、补差和余额规则会对所有客户生效，确定保存吗？">
        <h2>{t("全局加价规则")}</h2>
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

        <h3>{t("取消订单")}</h3>
        <div className="grid">
          <label className="f">{t("向客户收取手续费 %")}<input name="cancelFeePercent" type="number" step="0.01" defaultValue={s.cancelFeePercent} /></label>
          <label className="f">{t("ShipBest 收取取消费 %")}<input name="sbCancelFeePercent" type="number" step="0.01" defaultValue={s.sbCancelFeePercent} /></label>
        </div>
        <p className="small muted">{t("客户取消费按客户价计算，ShipBest 取消费按我们的成本计算；只有已出面单的订单才收取。确认取消时可以手动修改。")}</p>

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

      {/* 收款设置和“立即更新汇率”是两个表单（不能嵌套），放在同一张卡片里 */}
      <div className="card pay-card">
        <FlashForm action={savePaymentSettingsAction} submitLabel="保存收款设置" locked="客户充值页会显示这里的收款账号" confirm="客户会按这里的信息付款，请再核对一遍收款账号。确定保存吗？">
          <h2>{t("收款方式（客户充值）")}</h2>
          <p className="small muted">{t("客户在客户端“充值”页选择 Zelle（美元）或支付宝（人民币）付款，上传凭证后提交申请；你们在“财务”页确认到账后自动加到客户余额。余额以美元记账。")}</p>
          <div className="grid2">
            <label className="f">{t("Zelle 收款信息（显示给客户）")}
              <textarea name="zelleInfo" rows={3} defaultValue={s.zelleInfo} placeholder={t("邮箱 / 电话：pay@example.com\n户名：ATR Logistics LLC")} />
            </label>
            <label className="f">{t("支付宝收款信息（显示给客户）")}
              <textarea name="alipayInfo" rows={3} defaultValue={s.alipayInfo} placeholder={t("支付宝账号：xxx@xxx.com\n户名：某某")} />
            </label>
          </div>
          <div className="grid" style={{ marginTop: 10 }}>
            <label className="f" style={{ gridColumn: "span 2" }}>{t("支付宝收款码图片（PNG / JPG，可选）")}{s.alipayQr ? t("：已上传，重新选择可替换") : ""}
              <FilePick name="alipayQr" accept=".png,.jpg,.jpeg" />
            </label>
            {s.alipayQr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/api/assets/alipay-qr" alt={t("支付宝收款码")} style={{ width: 110, height: 110, objectFit: "contain", border: "1px solid var(--line)", borderRadius: 6 }} />
            )}
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
      </div>

      <StampSettings global={s.stamp} channels={channels.filter((c) => c.enabled).map((c) => ({ code: c.code, name: c.name, stamp: c.stamp }))} />

      <FlashForm action={saveChannelsAction} submitLabel="保存渠道设置" className="card" locked="开关渠道、改渠道加价会影响所有客户" confirm="渠道设置会对所有客户生效，确定保存吗？">
        <h2>{t("物流渠道")}</h2>
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

      {(() => {
        const st = testDataStats();
        return (
          <div className="card danger-card" id="cleanup">
            <h2>{t("上线前清空测试数据")}</h2>
            <p className="small muted">
              {t("删除所有订单、余额流水（客户余额归零）、充值申请、补差记录、批量导入记录和面单文件；客户、登录账号、渠道、价格设置、派送范围、报价表和寄件地址都会保留。清空前会自动备份数据库。")}
            </p>
            <p className="small">
              {t("现有：订单 {a}（其中正式单 {b}）、流水 {c}、充值申请 {d}、补差 {e}、批量导入 {f}", {
                a: st.shipments, b: st.liveShipments, c: st.ledger, d: st.topups, e: st.adjustments, f: st.batches,
              })}
            </p>
            {st.liveShipments > 0 ? (
              <div className="alert warn">{t("已经有正式订单，不能再清空。")}</div>
            ) : (
              <FlashForm action={clearTestDataAction} submitLabel="清空测试数据" submitClass="danger" confirm="确定清空所有测试数据吗？所有客户余额会归零，这一步不能撤销（会自动备份）。">
                <label className="f" style={{ maxWidth: 320, marginBottom: 10 }}>{t("输入“清空测试数据”确认")}
                  <input name="confirm" autoComplete="off" placeholder={lang === "en" ? "CLEAR" : "清空测试数据"} />
                </label>
              </FlashForm>
            )}
          </div>
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
