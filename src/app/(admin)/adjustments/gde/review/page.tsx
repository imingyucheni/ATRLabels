import Link from "next/link";
import { fmtTime } from "@/lib/time";
import { money } from "@/lib/pricing";
import FlashForm from "@/components/FlashForm";
import CopyText from "@/components/CopyText";
import { reopenBillIssueAction, resolveBillIssueAction } from "@/app/gdeBillActions";
import { gdeDisputeText, listBillIssues } from "@/lib/gdeBill";
import { GDE_ISSUE_LABEL } from "@/lib/gdeBillShared";
import { STATUS_LABEL } from "@/lib/db";
import { getLang } from "@/lib/prefs";
import { makeT, translateMessage } from "@/lib/i18n";

/** 嘉谷账单待核对：已取消仍被收费、状态对不上、系统里找不到的单，和嘉谷沟通完逐条标记已处理 */
export default async function GdeReviewPage() {
  const lang = await getLang();
  const t = makeT(lang);
  const open = listBillIssues({ status: "open" });
  const done = listBillIssues({ status: "resolved", limit: 50 });
  const dispute = gdeDisputeText(open);
  const charged = open.filter((i) => i.type === "cancelled_charged");
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{t("嘉谷账单待核对")}</h1>
        <Link href="/adjustments">{t("← 返回")}</Link>
      </div>
      <p className="muted">{t("导入嘉谷账单时发现的问题都在这里，客户余额没有动。和嘉谷沟通处理完后，写一句结果标记已处理；嘉谷之后的账单里把钱退回了，会自动标记。")}</p>
      <div className="stats">
        <div className="stat"><div className="muted">{t("待处理")}</div><div className={`v ${open.length ? "profit-neg" : ""}`}>{open.length}</div></div>
        <div className="stat"><div className="muted">{t("已取消仍被收费")}</div><div className={`v ${charged.length ? "profit-neg" : ""}`}>{charged.length}</div><div className="small muted">{money(charged.reduce((a, i) => a + i.amount, 0))}</div></div>
      </div>

      {dispute && (
        <div className="card">
          <h2>{t("发给嘉谷的核对说明（已取消仍被收费的 {n} 单）", { n: charged.length })}</h2>
          <CopyText text={dispute} label="复制说明" />
        </div>
      )}

      <div className="card table-wrap">
        <h2>{t("待处理（{n} 条）", { n: open.length })}</h2>
        <table>
          <thead><tr><th>{t("问题")}</th><th>{t("运单号 / 嘉谷订单号")}</th><th>{t("我们的订单")}</th><th className="num">{t("金额")}</th><th>{t("说明")}</th><th>{t("处理结果")}</th></tr></thead>
          <tbody>
            {open.map((i) => (
              <tr key={i.id}>
                <td className="small"><span className={`badge ${i.type === "cancelled_charged" ? "exception" : "warn"}`}>{t(GDE_ISSUE_LABEL[i.type])}</span><div className="muted">{fmtTime(i.updatedAt)}</div></td>
                <td className="small">{i.tracking}<div className="muted">{i.orderNo}</div></td>
                <td className="small">
                  {i.shipmentId ? <Link href={`/shipments/${i.shipmentId}`}>{i.customNo}</Link> : i.refNo || "-"}
                  {i.customerName && <div className="muted">{i.customerName}</div>}
                  {i.shipmentStatus && <div className="muted">{t(STATUS_LABEL[i.shipmentStatus as keyof typeof STATUS_LABEL] ?? i.shipmentStatus)}</div>}
                </td>
                <td className="num"><b>{money(i.amount)}</b></td>
                <td className="small">{translateMessage(lang, i.message)}<div className="muted">{i.sheet}</div></td>
                <td style={{ minWidth: 220 }}>
                  <FlashForm action={resolveBillIssueAction} submitLabel="标记已处理" submitClass="small">
                    <input type="hidden" name="id" value={i.id} />
                    <input name="note" placeholder={t("例如：嘉谷已同意退款")} maxLength={500} style={{ marginBottom: 6 }} />
                  </FlashForm>
                </td>
              </tr>
            ))}
            {!open.length && <tr><td colSpan={6} className="muted">{t("没有要核对的单")}</td></tr>}
          </tbody>
        </table>
      </div>

      {done.length > 0 && (
        <div className="card table-wrap">
          <h2>{t("最近处理的")}</h2>
          <table>
            <thead><tr><th>{t("问题")}</th><th>{t("运单号")}</th><th>{t("我们的订单")}</th><th className="num">{t("金额")}</th><th>{t("处理结果")}</th><th></th></tr></thead>
            <tbody>
              {done.map((i) => (
                <tr key={i.id}>
                  <td className="small">{t(GDE_ISSUE_LABEL[i.type])}</td>
                  <td className="small">{i.tracking}</td>
                  <td className="small">{i.shipmentId ? <Link href={`/shipments/${i.shipmentId}`}>{i.customNo}</Link> : i.refNo || "-"}</td>
                  <td className="num">{money(i.amount)}</td>
                  <td className="small">{translateMessage(lang, i.note ?? "")}<div className="muted">{translateMessage(lang, i.resolvedBy ?? "")} · {i.resolvedAt ? fmtTime(i.resolvedAt) : ""}</div></td>
                  <td><FlashForm action={reopenBillIssueAction} submitLabel="重新打开" submitClass="small"><input type="hidden" name="id" value={i.id} /></FlashForm></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
