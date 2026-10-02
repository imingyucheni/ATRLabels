import { fmtTime } from "@/lib/time";
import Link from "next/link";
import { customerChannels, getSettings, listCustomers } from "@/lib/db";
import { money } from "@/lib/pricing";
import { pendingResets } from "@/lib/passwordReset";
import FlashForm from "@/components/FlashForm";
import { handleResetRequestAction } from "@/app/actions";
import { getT } from "@/lib/prefs";
import { getTerms, lastAcceptance } from "@/lib/terms";
import { salesNameByCustomer } from "@/lib/commission";
import { currentAdmin } from "@/lib/auth";

const show = (v: number | null | undefined, dflt: string, suffix = "") => (v === null || v === undefined ? <span className="muted">{dflt}</span> : `${v}${suffix}`);

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const denied = (await searchParams).denied === "1";
  const customers = listCustomers();
  // 员工（二级管理员）看不到销售佣金、进不了客户 OMS、看不到面单记录（有成本）
  const staff = (await currentAdmin())?.role === "staff";
  const sales = staff ? new Map<number, string>() : salesNameByCustomer();
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
      {denied && <div className="alert warn">{t("这个功能只有主管理员能用。员工账号可以开客户账号、设置客户邮费、确认充值。")}</div>}
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{t("客户")}</h1>
        <Link className="btn primary" href="/customers/new">{t("＋ 新增客户")}</Link>
      </div>
      <div className="card table-wrap">
        <table className="card-table">
          <thead>
            <tr><th>{t("名称")}</th><th>{t("联系人")}</th><th>{t("电话")}</th><th>{t("登录")}</th><th>{t("合同")}</th><th>{t("渠道")}</th><th className="num">{t("余额")}</th><th className="num">{t("信用额度")}</th><th>{t("加价 %")}</th><th>{t("固定加价")}</th><th>{t("最低利润")}</th><th></th></tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td className="c-main"><Link href={`/customers/${c.id}`}>{c.name}</Link>{c.testAccount && <> <span className="badge test">{t("内部测试")}</span></>}{sales.get(c.id) && <div className="small muted">{t("销售：{name}", { name: sales.get(c.id)! })}</div>}</td><td data-label={t("联系人")}>{c.contact || "-"}</td><td data-label={t("电话")}>{c.phone || "-"}</td>
                <td className="small" data-label={t("登录")}>{c.portalEnabled ? c.portalEmail : <span className="muted">{t("未开通")}</span>}</td>
                <td className="small" data-label={t("合同")}>
                  {(() => {
                    // 合同（服务条款）签署状态：已签当前版本 / 签的是旧版本 / 还没签
                    const a = lastAcceptance(c.id);
                    const cur = getTerms().version;
                    if (!a) return <span className="badge pending">{t("未签")}</span>;
                    return (
                      <Link href={`/customers/${c.id}/terms`} title={`${[a.signer, a.signerTitle].filter(Boolean).join(" · ")} · ${fmtTime(a.acceptedAt)}`}>
                        <span className={`badge ${a.version === cur ? "ok" : "warn"}`}>{a.version === cur ? t("已签") : t("旧版 v{v}", { v: a.version })}</span>
                      </Link>
                    );
                  })()}
                </td>
                <td className="small" data-label={t("渠道")}>
                  {(() => {
                    const n = customerChannels(c.id).length;
                    return n ? <Link href={`/customers/${c.id}?tab=pricing#channels`}>{t("{n} 个", { n })}</Link> : <Link href={`/customers/${c.id}?tab=pricing#channels`} style={{ color: "var(--warn)" }}>{t("未开通")}</Link>;
                  })()}
                </td>
                <td className={`num ${c.balance < 0 ? "profit-neg" : ""}`} data-label={t("余额")}>{money(c.balance)}</td>
                <td className="num" data-label={t("信用额度")}>{c.creditLimit ? money(c.creditLimit) : "-"}</td>
                <td className="hide-m">{show(c.markup.percent, t("默认"), "%")}</td><td className="hide-m">{show(c.markup.fixed, t("默认"))}</td><td className="hide-m">{show(c.markup.minProfit, t("默认"))}</td>
                <td className="nowrap c-act c-links">
                  {!staff && <><a href={`/api/customers/${c.id}/oms`}>{t("进入 OMS")}</a><i> · </i></>}<Link href={`/customers/${c.id}`}>{t("管理")}</Link><i> · </i>{!staff && <><Link href={`/shipments?customerId=${c.id}`}>{t("面单")}</Link><i> · </i></>}<Link href={`/customers/${c.id}/charges`}>{t("扣款明细")}</Link><i> · </i><Link href={`/customers/${c.id}/statement`}>{t("对账单")}</Link>
                </td>
              </tr>
            ))}
            {!customers.length && <tr><td colSpan={12} className="muted">{t("还没有客户，先新增一个")}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        {t("“默认”表示沿用渠道或全局设置（当前全局：+{p}%，固定 {f}，最低利润 {m}）。", { p: markup.percent, f: markup.fixed, m: markup.minProfit })}
      </p>
    </>
  );
}
