import Link from "next/link";
import FlashForm from "@/components/FlashForm";
import { updateLeadAction } from "@/app/actions";
import { LEAD_STATUS_LABEL, listLeads } from "@/lib/leads";
import { getT } from "@/lib/prefs";
import { fmtTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const TONE = { new: "pending", contacted: "test", done: "ok", rejected: "cancelled" } as const;

export default async function LeadsPage() {
  const t = await getT();
  const leads = listLeads();
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{t("开户申请")}</h1>
          <p className="small muted" style={{ margin: 0 }}>{t("官网上“申请开户”提交的联系方式。联系后改状态、写备注，开户请到“客户管理”新建客户。")}</p>
        </div>
        <Link className="btn" href="/site" target="_blank">{t("查看官网")}</Link>
      </div>
      <div className="card table-wrap" style={{ marginTop: 12 }}>
        <table className="list">
          <thead>
            <tr><th>{t("时间")}</th><th>{t("公司 / 店铺")}</th><th>{t("联系方式")}</th><th>{t("每月单量")}</th><th>{t("备注")}</th><th>{t("状态 / 跟进")}</th></tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td className="small muted">{fmtTime(l.createdAt)}</td>
                <td className="wrap"><b>{l.company}</b><div className="small muted">{l.contact}</div></td>
                <td className="small wrap">
                  {l.wechat && <div>{t("微信")}：{l.wechat}</div>}
                  {l.phone && <div>{t("电话")}：{l.phone}</div>}
                  {l.email && <div>{t("邮箱")}：<a href={`mailto:${l.email}`}>{l.email}</a></div>}
                </td>
                <td className="small">{l.volume ? t(l.volume) : "-"}</td>
                <td className="small wrap wide">{l.note || "-"}</td>
                <td>
                  <span className={`badge ${TONE[l.status]}`}>{t(LEAD_STATUS_LABEL[l.status])}</span>
                  <FlashForm action={updateLeadAction} submitLabel="保存" submitClass="small">
                    <input type="hidden" name="id" value={l.id} />
                    <div className="row" style={{ gap: 6, margin: "6px 0" }}>
                      <select name="status" defaultValue={l.status} aria-label={t("状态")}>
                        {Object.entries(LEAD_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
                      </select>
                      <input name="adminNote" defaultValue={l.adminNote ?? ""} placeholder={t("跟进备注")} maxLength={200} style={{ width: 160 }} />
                    </div>
                  </FlashForm>
                </td>
              </tr>
            ))}
            {!leads.length && <tr><td colSpan={6} className="muted">{t("还没有开户申请。官网地址就是客户 OMS 网址的首页。")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
