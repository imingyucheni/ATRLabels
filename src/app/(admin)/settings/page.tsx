import { ADJUSTMENT_POLICY_LABEL, channelCustomerCounts, getSettings, listChannels } from "@/lib/db";
import { BALANCE_RULE_LABEL } from "@/lib/ledger";
import { computePrice, money, resolveRule, type MarkupRule } from "@/lib/pricing";
import { isMockMode } from "@/lib/shipbest/client";
import AddressFields from "@/components/AddressFields";
import StampSettings from "@/components/StampSettings";
import FlashForm from "@/components/FlashForm";
import RuleInputs from "@/components/RuleInputs";
import { refreshFxAction, saveChannelsAction, savePaymentSettingsAction, saveSettingsAction, syncChannelsAction, verifyAction } from "@/app/actions";
import { cnyToPay, usdCnyQuote } from "@/lib/fx";

export default async function SettingsPage() {
  const s = getSettings();
  const fx = await usdCnyQuote();
  const channels = listChannels();
  const opened = channelCustomerCounts();
  const configured = isMockMode() || (!!process.env.SHIPBEST_API_ID && !!process.env.SHIPBEST_ACCESS_TOKEN);
  const example = [5, 10, 20];

  return (
    <>
      <h1>设置</h1>

      <div className="card">
        <h2>ShipBest 连接</h2>
        <p className="small muted">
          apiId / accessToken 通过服务器环境变量 <code>SHIPBEST_API_ID</code>、<code>SHIPBEST_ACCESS_TOKEN</code> 配置（在 OMS 后台的 API 配置里获取），不保存在数据库中。
          {isMockMode() ? " 当前为模拟模式（SHIPBEST_MOCK=1），不会真实下单。" : configured ? " 已配置。" : " 尚未配置。"}
        </p>
        <div className="row">
          <FlashForm action={verifyAction} submitLabel="测试连接" submitClass="" inline />
          <FlashForm action={syncChannelsAction} submitLabel="同步渠道" inline />
        </div>
      </div>

      <FlashForm action={saveSettingsAction} submitLabel="保存设置" className="card">
        <h2>全局加价规则</h2>
        <p className="small muted">
          客户价 = max(成本 × (1 + 加价%) + 固定加价, 成本 + 最低利润)，再按取整步长向上取整。
          优先级：客户专属设置 &gt; 渠道设置 &gt; 全局默认（按字段逐项覆盖）。成本 = ShipBest 试算的“优惠后总运费”。
        </p>
        <div className="grid">
          <RuleInputs value={s.markup} />
          <label className="f">取整步长
            <select name="roundingStep" defaultValue={String(s.roundingStep)}>
              <option value="0.01">0.01（不取整）</option>
              <option value="0.05">0.05</option>
              <option value="0.1">0.10</option>
              <option value="0.5">0.50</option>
              <option value="1">1.00</option>
            </select>
          </label>
        </div>
        <p className="small muted">
          示例：{example.map((c) => `成本 ${money(c)} → 客户价 ${money(computePrice(c, s.markup, s.roundingStep))}`).join("；")}
        </p>

        <h3>取消订单</h3>
        <div className="grid">
          <label className="f">向客户收取手续费 %<input name="cancelFeePercent" type="number" step="0.01" defaultValue={s.cancelFeePercent} /></label>
          <label className="f">ShipBest 收取取消费 %<input name="sbCancelFeePercent" type="number" step="0.01" defaultValue={s.sbCancelFeePercent} /></label>
        </div>
        <p className="small muted">客户取消费按客户价计算，ShipBest 取消费按我们的成本计算；只有已出面单的订单才收取。确认取消时可以手动修改。</p>

        <h3>官方账单补差（多退少补）</h3>
        <div className="grid">
          <label className="f" style={{ gridColumn: "span 2" }}>补差如何转嫁给客户
            <select name="adjustmentPolicy" defaultValue={s.adjustmentPolicy}>
              {Object.entries(ADJUSTMENT_POLICY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <p className="small muted">ShipBest 扣的是预报价，官方账单出来后按重量或分区差异多退少补。在“补差导入”上传他们的表格时，按这里的规则计算向客户补收或退还的金额（导入时的规则会记录在批次上）。</p>

        <h3>客户余额与充值</h3>
        <div className="grid">
          <label className="f" style={{ gridColumn: "span 2" }}>下单余额规则
            <select name="balanceRule" defaultValue={s.balanceRule}>
              {Object.entries(BALANCE_RULE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <p className="small muted">月结客户可以在客户页面设置信用额度：可用余额 = 余额 + 信用额度。后台代客户下单也按这个规则检查。收款方式在下方“收款方式”里设置。</p>

        <h3>客户端</h3>
        <div className="grid">
          <label className="f">客户端显示的公司名称<input name="brandName" defaultValue={s.brandName} maxLength={60} /></label>
          <label className="f" style={{ gridColumn: "span 2" }}>客服联系方式（显示在客户端）<input name="supportContact" defaultValue={s.supportContact} maxLength={200} placeholder="例如：微信 xxx / 邮箱 support@xxx.com" /></label>
        </div>
        <p className="small muted">客户登录地址：<code>/portal</code>。在“客户”页面给客户开通登录。</p>

        <h3>默认值</h3>
        <div className="grid">
          <label className="f">默认单位
            <select name="defaultUnit" defaultValue={String(s.defaultUnit)}>
              <option value="3">lb / in（英制）</option>
              <option value="2">kg / cm</option>
              <option value="1">g / cm</option>
            </select>
          </label>
          <label className="f">默认币种<input name="defaultCurrency" defaultValue={s.defaultCurrency} maxLength={3} /></label>
        </div>

        <h3>默认寄件地址（发货仓）</h3>
        <AddressFields value={s.sender} namePrefix="sender." />
        <div style={{ height: 12 }} />
      </FlashForm>

      <FlashForm action={savePaymentSettingsAction} submitLabel="保存收款设置" className="card">
        <h2>收款方式（客户充值）</h2>
        <p className="small muted">客户在客户端“充值”页选择 Zelle（美元）或支付宝（人民币）付款，上传凭证后提交申请；你们在“财务”页确认到账后自动加到客户余额。余额以美元记账。</p>
        <div className="grid2">
          <label className="f">Zelle 收款信息（显示给客户）
            <textarea name="zelleInfo" rows={3} defaultValue={s.zelleInfo} placeholder={"邮箱 / 电话：pay@example.com\n户名：ATR Logistics LLC"} />
          </label>
          <label className="f">支付宝收款信息（显示给客户）
            <textarea name="alipayInfo" rows={3} defaultValue={s.alipayInfo} placeholder={"支付宝账号：xxx@xxx.com\n户名：某某"} />
          </label>
        </div>
        <div className="grid" style={{ marginTop: 10 }}>
          <label className="f" style={{ gridColumn: "span 2" }}>支付宝收款码图片（PNG / JPG，可选）{s.alipayQr ? "：已上传，重新选择可替换" : ""}
            <input type="file" name="alipayQr" accept=".png,.jpg,.jpeg" />
          </label>
          {s.alipayQr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/api/assets/alipay-qr" alt="支付宝收款码" style={{ width: 110, height: 110, objectFit: "contain", border: "1px solid var(--line)", borderRadius: 6 }} />
          )}
        </div>
        <h3>人民币汇率</h3>
        <div className="grid">
          <label className="f">汇率来源
            <select name="fxMode" defaultValue={s.fxMode}>
              <option value="auto">当天实时汇率 + 加点（推荐）</option>
              <option value="manual">固定汇率 + 加点</option>
            </select>
          </label>
          <label className="f">加点（加在汇率上，例如 0.03）<input name="fxMarkup" type="number" step="0.001" min="0" max="1" defaultValue={s.fxMarkup} /></label>
          <label className="f">固定 / 备用汇率<input name="fxManualRate" type="number" step="0.0001" defaultValue={s.fxManualRate} /></label>
        </div>
        <p className="small">
          当前：{fx.manual ? `${fx.source} ${fx.live}` : `实时汇率 ${fx.live}（${fx.source}${fx.fetchedAt ? "，" + fx.fetchedAt.slice(0, 16).replace("T", " ") + " UTC" : ""}）`}
          {" "}+ 加点 {fx.markup} = <b>充值汇率 {fx.rate}</b>（充 100 美元需付 ¥{cnyToPay(100, fx.rate).toFixed(2)}）
        </p>
        <p className="small muted">实时汇率每小时自动更新（来源：ExchangeRate-API，备用欧洲央行数据）；获取失败时使用最近一次的实时汇率，再不行用备用汇率。</p>
        <label className="f" style={{ margin: "8px 0 12px" }}>充值页其他说明（可选）
          <textarea name="topupInstructions" rows={2} defaultValue={s.topupInstructions} placeholder="例如：转账备注请写公司名；工作日 2 小时内确认到账" />
        </label>
      </FlashForm>
      <div style={{ marginTop: -8, marginBottom: 16 }}>
        <FlashForm action={refreshFxAction} submitLabel="立即更新汇率" submitClass="small" inline />
      </div>

      <StampSettings global={s.stamp} channels={channels.filter((c) => c.enabled).map((c) => ({ code: c.code, name: c.name, stamp: c.stamp }))} />

      <FlashForm action={saveChannelsAction} submitLabel="保存渠道设置" className="card">
        <h2>物流渠道</h2>
        <p className="small muted">这里是总开关：取消勾选的渠道所有客户都不能用。每个客户具体能用哪些渠道，在“客户”详情里单独开通（新客户默认不开通）。加价留空 = 沿用全局设置。</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>启用</th><th>渠道</th><th>加价 %</th><th>固定加价</th><th>最低利润</th><th>成本 10.00 时客户价</th><th className="num">开通客户</th></tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.code}>
                  <td><input type="checkbox" name={`enabled.${c.code}`} defaultChecked={c.enabled} /></td>
                  <td>{c.name}<div className="small muted">{c.code}</div></td>
                  <RuleCells prefix={`${c.code}.`} value={c.markup} global={s.markup} />
                  <td>{money(computePrice(10, resolveRule(s.markup, c.markup), s.roundingStep))}</td>
                  <td className="num">{opened[c.code] ?? 0}</td>
                </tr>
              ))}
              {!channels.length && <tr><td colSpan={7} className="muted">还没有渠道，请点上方“同步渠道”</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ height: 12 }} />
      </FlashForm>
    </>
  );
}

function RuleCells({ prefix, value, global }: { prefix: string; value: Record<string, number | null | undefined>; global: MarkupRule }) {
  const v = (x: number | null | undefined) => (x === null || x === undefined ? "" : String(x));
  return (
    <>
      {(["percent", "fixed", "minProfit"] as const).map((k) => (
        <td key={k}>
          <input name={prefix + k} type="number" step="0.01" defaultValue={v(value[k])} placeholder={`默认 ${global[k]}`} style={{ width: 110 }} />
        </td>
      ))}
    </>
  );
}
