import { ADJUSTMENT_POLICY_LABEL, getSettings, listChannels } from "@/lib/db";
import { computePrice, money, resolveRule, type MarkupRule } from "@/lib/pricing";
import { isMockMode } from "@/lib/shipbest/client";
import AddressFields from "@/components/AddressFields";
import FlashForm from "@/components/FlashForm";
import RuleInputs from "@/components/RuleInputs";
import { saveChannelsAction, saveSettingsAction, syncChannelsAction, verifyAction } from "@/app/actions";

export default async function SettingsPage() {
  const s = getSettings();
  const channels = listChannels();
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

      <FlashForm action={saveChannelsAction} submitLabel="保存渠道设置" className="card">
        <h2>物流渠道</h2>
        <p className="small muted">勾选的渠道会出现在报价里。加价留空 = 沿用全局设置。</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>启用</th><th>渠道</th><th>加价 %</th><th>固定加价</th><th>最低利润</th><th>成本 10.00 时客户价</th></tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.code}>
                  <td><input type="checkbox" name={`enabled.${c.code}`} defaultChecked={c.enabled} /></td>
                  <td>{c.name}<div className="small muted">{c.code}</div></td>
                  <RuleCells prefix={`${c.code}.`} value={c.markup} global={s.markup} />
                  <td>{money(computePrice(10, resolveRule(s.markup, c.markup), s.roundingStep))}</td>
                </tr>
              ))}
              {!channels.length && <tr><td colSpan={6} className="muted">还没有渠道，请点上方“同步渠道”</td></tr>}
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
