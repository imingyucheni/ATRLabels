import { fmtTime } from "@/lib/time";
import Link from "next/link";
import { customerChannels, getSettings, listCustomers } from "@/lib/db";
import { money } from "@/lib/pricing";
import { pendingResets } from "@/lib/passwordReset";
import FlashForm from "@/components/FlashForm";
import { handleResetRequestAction } from "@/app/actions";
import { getT } from "@/lib/prefs";

const show = (v: number | null | undefined, dflt: string, suffix = "") => (v === null || v === undefined ? <span className="muted">{dflt}</span> : `${v}${suffix}`);

export default async function CustomersPage() {
  const customers = listCustomers();
  const { markup } = getSettings();
  const resets = pendingResets();
  const t = await getT();
  return (
    <>
      {resets.length > 0 && (
        <div className="card" style={{ borderColor: "var(--warn)" }}>
          <div className="card-head"><h2>{t("客户申请重置密码（{n}）", { n: resets.length })}</h2><span className="small muted">{t("没有配置邮件发送时，由这里生成新密码后告诉客户")}</span></div>
          <table className="list">
            <tbody>
              {resets.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}<div className="small muted">{r.portal_email}</div></td>
                  <td className="small muted">{fmtTime(r.created_at)}</td>
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
        <h1 style={{ margin: 0 }}>{t("客户")}</h1>
        <Link className="btn primary" href="/customers/new">{t("＋ 新增客户")}</Link>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>{t("名称")}</th><th>{t("联系人")}</th><th>{t("电话")}</th><th>{t("登录")}</th><th>{t("渠道")}</th><th className="num">{t("余额")}</th><th className="num">{t("信用额度")}</th><th>{t("加价 %")}</th><th>{t("固定加价")}</th><th>{t("最低利润")}</th><th></th></tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td><td>{c.contact}</td><td>{c.phone}</td>
                <td className="small">{c.portalEnabled ? c.portalEmail : <span className="muted">{t("未开通")}</span>}</td>
                <td className="small">
                  {(() => {
                    const n = customerChannels(c.id).length;
                    return n ? <Link href={`/customers/${c.id}#channels`}>{t("{n} 个", { n })}</Link> : <Link href={`/customers/${c.id}#channels`} style={{ color: "var(--warn)" }}>{t("未开通")}</Link>;
                  })()}
                </td>
                <td className={`num ${c.balance < 0 ? "profit-neg" : ""}`}>{money(c.balance)}</td>
                <td className="num">{c.creditLimit ? money(c.creditLimit) : "-"}</td>
                <td>{show(c.markup.percent, t("默认"), "%")}</td><td>{show(c.markup.fixed, t("默认"))}</td><td>{show(c.markup.minProfit, t("默认"))}</td>
                <td>
                  <a href={`/api/customers/${c.id}/oms`}>{t("进入 OMS")}</a> · <Link href={`/customers/${c.id}`}>{t("管理")}</Link> · <Link href={`/shipments?customerId=${c.id}`}>{t("面单")}</Link> · <Link href={`/customers/${c.id}/charges`}>{t("扣款明细")}</Link> · <Link href={`/customers/${c.id}/statement`}>{t("对账单")}</Link>
                </td>
              </tr>
            ))}
            {!customers.length && <tr><td colSpan={11} className="muted">{t("还没有客户，先新增一个")}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        {t("“默认”表示沿用渠道或全局设置（当前全局：+{p}%，固定 {f}，最低利润 {m}）。", { p: markup.percent, f: markup.fixed, m: markup.minProfit })}
      </p>
    </>
  );
}
