import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomer, getSettings } from "@/lib/db";
import FlashForm from "@/components/FlashForm";
import RuleInputs from "@/components/RuleInputs";
import AddressFields from "@/components/AddressFields";
import { LEDGER_TYPE_LABEL, listLedger } from "@/lib/ledger";
import { money } from "@/lib/pricing";
import { ledgerEntryAction, saveCustomerAction, saveCustomerPortalAction, saveCustomerSenderAction, setCustomerPasswordAction } from "@/app/actions";

export default async function CustomerEdit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = id === "new" ? null : getCustomer(Number(id));
  if (id !== "new" && !c) notFound();
  const { markup } = getSettings();
  const ledger = c ? listLedger({ customerId: c.id, limit: 100 }) : [];
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{c ? `编辑客户：${c.name}` : "新增客户"}</h1>
        <Link href="/customers">← 返回</Link>
      </div>
      <FlashForm action={saveCustomerAction} submitLabel="保存" className="card">
        <input type="hidden" name="id" value={c?.id ?? ""} />
        <div className="grid">
          <label className="f"><span className="req">名称</span><input name="name" required defaultValue={c?.name} /></label>
          <label className="f">联系人<input name="contact" defaultValue={c?.contact ?? ""} /></label>
          <label className="f">电话<input name="phone" defaultValue={c?.phone ?? ""} /></label>
          <label className="f">邮箱<input name="email" type="email" defaultValue={c?.email ?? ""} /></label>
        </div>
        <h3>专属加价（留空 = 沿用渠道 / 全局设置）</h3>
        <div className="grid">
          <RuleInputs value={c?.markup} placeholder={{ percent: `默认 ${markup.percent}`, fixed: `默认 ${markup.fixed}`, minProfit: `默认 ${markup.minProfit}` }} />
        </div>
        <label className="f" style={{ margin: "12px 0" }}>备注<textarea name="note" rows={2} defaultValue={c?.note ?? ""} /></label>
      </FlashForm>
      {c && (
        <>
          <div className="stats">
            <div className="stat"><div className="muted">账户余额</div><div className={`v ${c.balance < 0 ? "profit-neg" : ""}`}>{money(c.balance)}</div></div>
            <div className="stat"><div className="muted">信用额度</div><div className="v">{money(c.creditLimit)}</div></div>
            <div className="stat"><div className="muted">可用额度</div><div className="v">{money(c.balance + c.creditLimit)}</div></div>
            <div className="stat"><div className="muted">客户端登录</div><div className="v" style={{ fontSize: 16 }}>{c.portalEnabled ? (c.hasPassword ? "已开通" : "未设密码") : "未开通"}</div></div>
          </div>

          <div className="grid2">
            <FlashForm action={ledgerEntryAction} submitLabel="确认" className="card" resetOnSuccess>
              <h2>充值 / 调账</h2>
              <input type="hidden" name="id" value={c.id} />
              <div className="grid" style={{ marginBottom: 12 }}>
                <label className="f">类型
                  <select name="type" defaultValue="topup">
                    <option value="topup">充值（客户付款到账）</option>
                    <option value="manual">手动调账（正数加、负数扣）</option>
                  </select>
                </label>
                <label className="f"><span className="req">金额</span><input name="amount" type="number" step="0.01" required /></label>
                <label className="f" style={{ gridColumn: "span 2" }}>说明<input name="note" maxLength={200} placeholder="例如：9月转账 / 赔偿 / 月结账单" /></label>
              </div>
            </FlashForm>

            <div className="card">
              <h2>客户端登录</h2>
              <FlashForm action={saveCustomerPortalAction} submitLabel="保存登录设置">
                <input type="hidden" name="id" value={c.id} />
                <div className="grid" style={{ marginBottom: 12 }}>
                  <label className="f" style={{ gridColumn: "span 2" }}>登录邮箱<input name="portalEmail" type="email" defaultValue={c.portalEmail ?? ""} /></label>
                  <label className="f">信用额度
                    <input name="creditLimit" type="number" step="0.01" min="0" defaultValue={c.creditLimit} />
                  </label>
                  <label className="f" style={{ justifyContent: "flex-end" }}>
                    <span><input type="checkbox" name="portalEnabled" defaultChecked={c.portalEnabled} /> 允许客户登录</span>
                  </label>
                </div>
                <p className="small muted">信用额度：余额可以透支到负多少。预付客户填 0；月结客户填一个额度。后台代客户下单也按这个额度检查。</p>
              </FlashForm>
              <FlashForm action={setCustomerPasswordAction} submitLabel={c.hasPassword ? "重置密码" : "设置密码"} submitClass="">
                <input type="hidden" name="id" value={c.id} />
                <label className="f" style={{ marginBottom: 8 }}>新密码（留空自动生成）<input name="password" type="text" autoComplete="off" minLength={8} /></label>
              </FlashForm>
              <p className="small muted">客户登录地址：<code>/portal</code></p>
            </div>
          </div>

          <FlashForm action={saveCustomerSenderAction} submitLabel="保存寄件地址" className="card">
            <h2>客户默认寄件地址</h2>
            <p className="small muted">留空则使用系统默认寄件地址。客户也可以在客户端自己修改。</p>
            <input type="hidden" name="id" value={c.id} />
            <AddressFields value={c.sender} namePrefix="sender." />
            <div style={{ height: 12 }} />
          </FlashForm>

          <div className="card table-wrap">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>账户流水（最近 100 条）</h2>
              <span><Link href={`/customers/${c.id}/statement`}>对账单</Link> · <Link href={`/shipments?customerId=${c.id}`}>面单</Link></span>
            </div>
            <table>
              <thead><tr><th>时间</th><th>类型</th><th>单号</th><th>说明</th><th>操作人</th><th className="num">金额</th><th className="num">余额</th></tr></thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="small muted">{l.createdAt}</td>
                    <td>{LEDGER_TYPE_LABEL[l.type]}</td>
                    <td>{l.shipmentId ? <Link href={`/shipments/${l.shipmentId}`}>{l.customNo}</Link> : "-"}</td>
                    <td className="small">{l.note}</td>
                    <td className="small muted">{l.createdBy === "customer" ? "客户" : l.createdBy === "system" ? "系统" : "后台"}</td>
                    <td className={`num ${l.amount >= 0 ? "profit-pos" : ""}`}>{l.amount >= 0 ? "+" : ""}{money(l.amount)}</td>
                    <td className="num">{money(l.balanceAfter)}</td>
                  </tr>
                ))}
                {!ledger.length && <tr><td colSpan={7} className="muted">还没有流水</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
