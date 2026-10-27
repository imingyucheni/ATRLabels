import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtTime } from "@/lib/time";
import { money } from "@/lib/pricing";
import FlashForm from "@/components/FlashForm";
import { deleteGdeBillAction } from "@/app/gdeBillActions";
import { getGdeBill } from "@/lib/gdeBill";
import { GDE_KIND_LABEL } from "@/lib/gdeBillShared";
import { getLang } from "@/lib/prefs";
import { makeT, translateMessage } from "@/lib/i18n";

/** 一次嘉谷账单导入：导了哪些表、记了多少补差、哪些单要核对 */
export default async function GdeBillPage({ params }: { params: Promise<{ id: string }> }) {
  const b = getGdeBill(Number((await params).id));
  if (!b) notFound();
  const lang = await getLang();
  const t = makeT(lang);
  const { totals, sheets, issues, notInSystem, summary } = b.stats;
  const warns = issues.filter((i) => i.level === "warn");
  const infos = issues.filter((i) => i.level === "info");
  const table = (list: typeof issues) => (
    <div className="table-wrap">
      <table>
        <thead><tr><th>{t("表")}</th><th>{t("运单号")}</th><th>{t("订单")}</th><th className="num">{t("金额")}</th><th>{t("说明")}</th></tr></thead>
        <tbody>
          {list.map((x, i) => (
            <tr key={i}>
              <td className="small">{x.sheet}</td>
              <td className="small">{x.tracking}</td>
              <td className="small">{x.shipmentId ? <Link href={`/shipments/${x.shipmentId}`}>{x.customNo}</Link> : "-"}</td>
              <td className="num">{money(x.amount)}</td>
              <td className="small">{translateMessage(lang, x.message)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{t("嘉谷账单：{name}", { name: b.filename })}</h1>
        <Link href="/adjustments">{t("← 返回")}</Link>
      </div>
      <div className="stats">
        <div className="stat"><div className="muted">{t("导入时间")}</div><div>{fmtTime(b.createdAt)}</div></div>
        <div className="stat"><div className="muted">{t("新的行")}</div><div className="v">{totals.newLines}</div><div className="small muted">{t("之前导入过 {n} 行（跳过）", { n: totals.alreadyImported })}</div></div>
        <div className="stat"><div className="muted">{t("新账单金额")}</div><div className="v">{money(totals.newBilled)}</div></div>
        <div className="stat"><div className="muted">{t("记补差")}</div><div className="v">{money(totals.costToBook)}</div><div className="small muted">{t("向客户 {a}", { a: money(totals.customerTotal) })}</div></div>
        <div className="stat"><div className="muted">{t("需要核对")}</div><div className={`v ${warns.length ? "profit-neg" : ""}`}>{warns.length}</div></div>
        <div className="stat"><div className="muted">{t("系统里没有的单")}</div><div className="v">{notInSystem.count}</div><div className="small muted">{money(notInSystem.total)}</div></div>
      </div>
      {b.adjustmentBatchId && <p><Link href={`/adjustments/${b.adjustmentBatchId}`}>{t("查看这次记的补差明细（可以手动关联、导出给客户）→")}</Link></p>}
      {summary && (
        <p className="small">
          <b>{t("嘉谷账户（汇总表）")}</b>{t("：")}{t("付款合计 {a}", { a: money(summary.paymentTotal) })}
          {summary.balance !== null && <> · {t("结余 {a}", { a: money(summary.balance) })}</>}
          {summary.extras.filter((x) => x.value).map((x) => <span key={x.label}> · {t(x.label)} {money(x.value)}</span>)}
        </p>
      )}

      <div className="card">
        <h2>{t("需要核对（{n} 条）", { n: warns.length })}</h2>
        {warns.length ? table(warns) : <p className="muted">{t("没有")}</p>}
      </div>
      {infos.length > 0 && <div className="card"><h2>{t("其他说明（{n} 条）", { n: infos.length })}</h2>{table(infos)}</div>}

      <div className="card table-wrap">
        <h2>{t("这次导入的表")}</h2>
        <table>
          <thead><tr><th>{t("表")}</th><th>{t("类型")}</th><th className="num">{t("新的行")}</th><th className="num">{t("新增金额")}</th></tr></thead>
          <tbody>{sheets.map((s) => <tr key={s.name}><td>{s.name}</td><td className="small">{t(GDE_KIND_LABEL[s.kind])}</td><td className="num">{s.newLines}</td><td className="num">{money(s.newTotal)}</td></tr>)}</tbody>
        </table>
      </div>

      <FlashForm action={deleteGdeBillAction} submitLabel="撤销这次导入" submitClass="danger" confirm="确认撤销？这次记下的账单行和补差都会删除（客户余额里的补差一起撤回），之后可以重新导入。">
        <input type="hidden" name="id" value={b.id} />
      </FlashForm>
    </>
  );
}
