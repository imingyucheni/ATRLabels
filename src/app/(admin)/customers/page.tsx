import Link from "next/link";
import { customerChannels, getSettings, listCustomers } from "@/lib/db";
import { money } from "@/lib/pricing";
import { pendingResets } from "@/lib/passwordReset";
import FlashForm from "@/components/FlashForm";
import { handleResetRequestAction } from "@/app/actions";

const show = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? <span className="muted">默认</span> : `${v}${suffix}`);

export default async function CustomersPage() {
  const customers = listCustomers();
  const { markup } = getSettings();
  const resets = pendingResets();
  return (
    <>
      {resets.length > 0 && (
        <div className="card" style={{ borderColor: "var(--warn)" }}>
          <div className="card-head"><h2>客户申请重置密码（{resets.length}）</h2><span className="small muted">没有配置邮件发送时，由这里生成新密码后告诉客户</span></div>
          <table>
            <tbody>
              {resets.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}<div className="small muted">{r.portal_email}</div></td>
                  <td className="small muted">{r.created_at} UTC</td>
                  <td style={{ width: 380 }}>
                    <FlashForm action={handleResetRequestAction} submitLabel="生成新密码" submitClass="small" confirm="为这个客户生成新密码？旧密码会失效。">
                      <input type="hidden" name="id" value={r.id} />
                    </FlashForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>客户</h1>
        <Link className="btn primary" href="/customers/new">＋ 新增客户</Link>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>名称</th><th>联系人</th><th>电话</th><th>登录</th><th>渠道</th><th className="num">余额</th><th className="num">信用额度</th><th>加价 %</th><th>固定加价</th><th>最低利润</th><th></th></tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td><td>{c.contact}</td><td>{c.phone}</td>
                <td className="small">{c.portalEnabled ? c.portalEmail : <span className="muted">未开通</span>}</td>
                <td className="small">
                  {(() => {
                    const n = customerChannels(c.id).length;
                    return n ? <Link href={`/customers/${c.id}#channels`}>{n} 个</Link> : <Link href={`/customers/${c.id}#channels`} style={{ color: "var(--warn)" }}>未开通</Link>;
                  })()}
                </td>
                <td className={`num ${c.balance < 0 ? "profit-neg" : ""}`}>{money(c.balance)}</td>
                <td className="num">{c.creditLimit ? money(c.creditLimit) : "-"}</td>
                <td>{show(c.markup.percent, "%")}</td><td>{show(c.markup.fixed)}</td><td>{show(c.markup.minProfit)}</td>
                <td>
                  <Link href={`/customers/${c.id}`}>管理</Link> · <Link href={`/shipments?customerId=${c.id}`}>面单</Link> · <Link href={`/customers/${c.id}/charges`}>扣款明细</Link> · <Link href={`/customers/${c.id}/statement`}>对账单</Link>
                </td>
              </tr>
            ))}
            {!customers.length && <tr><td colSpan={11} className="muted">还没有客户，先新增一个</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        “默认”表示沿用渠道或全局设置（当前全局：+{markup.percent}%，固定 {markup.fixed}，最低利润 {markup.minProfit}）。
      </p>
    </>
  );
}
