import { fmtTime } from "@/lib/time";
import Link from "next/link";
import { ADJUSTMENT_POLICY_LABEL, getSettings, listAdjustmentBatches } from "@/lib/db";
import { money } from "@/lib/pricing";
import ImportAdjustments from "./ImportAdjustments";
import GdeBillImport from "./GdeBillImport";
import { getT } from "@/lib/prefs";
import { listGdeBills } from "@/lib/gdeBill";

export default async function AdjustmentsPage() {
  const t = await getT();
  const batches = listAdjustmentBatches();
  const bills = listGdeBills();
  const { adjustmentPolicy } = getSettings();
  return (
    <>
      <h1>{t("官方账单补差")}</h1>
      <p className="muted">
        {t("嘉谷的对账单用下面第一个框上传（自动识别每张表）。")}{" "}
        {t("ShipBest 系统扣的是预报价格，官方账单出来后，重量或分区有差异会多退少补。收到他们的补差表格后在这里上传，")}{" "}
        {t("系统按运单号（或 ShipBest 单号 / 自定义单号）自动对应到面单和客户。当前转嫁规则：")}<b>{t(ADJUSTMENT_POLICY_LABEL[adjustmentPolicy])}</b>
        {t("（")}<Link href="/settings#rules">{t("修改")}</Link>{t("）。")}
      </p>
      <GdeBillImport />
      {bills.length > 0 && (
        <div className="card table-wrap">
          <h2>{t("嘉谷账单导入记录")}</h2>
          <table>
            <thead>
              <tr><th>{t("导入时间")}</th><th>{t("文件")}</th><th className="num">{t("新的行")}</th><th className="num">{t("账单金额")}</th><th className="num">{t("记补差")}</th><th className="num">{t("向客户补收/退")}</th><th className="num">{t("需要核对")}</th><th></th></tr>
            </thead>
            <tbody>
              {bills.map((b) => {
                const warn = b.stats.issues.filter((i) => i.level === "warn").length;
                return (
                  <tr key={b.id}>
                    <td className="small muted">{fmtTime(b.createdAt)}</td>
                    <td>{b.filename}</td>
                    <td className="num">{b.stats.totals.newLines}</td>
                    <td className="num">{money(b.stats.totals.newBilled)}</td>
                    <td className="num">{money(b.stats.totals.costToBook)}</td>
                    <td className="num">{money(b.stats.totals.customerTotal)}</td>
                    <td className="num">{warn ? <span className="profit-neg">{warn}</span> : 0}</td>
                    <td><Link href={`/adjustments/gde/${b.id}`}>{t("查看")}</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ImportAdjustments />

      <div className="card table-wrap">
        <h2>{t("导入记录")}</h2>
        <table>
          <thead>
            <tr><th>{t("导入时间")}</th><th>{t("文件")}</th><th className="num">{t("行数")}</th><th className="num">{t("已匹配")}</th><th className="num">{t("ShipBest 补差")}</th><th className="num">{t("向客户补收/退")}</th><th>{t("规则")}</th><th></th></tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id}>
                <td className="small muted">{fmtTime(b.createdAt)}</td>
                <td>{b.filename}{b.note && <div className="small muted">{b.note}</div>}</td>
                <td className="num">{b.rowCount}</td>
                <td className="num">{b.matchedCount === b.rowCount ? b.matchedCount : <span className="profit-neg">{b.matchedCount}</span>}</td>
                <td className="num">{money(b.costTotal)}</td>
                <td className="num">{money(b.customerTotal)}</td>
                <td className="small">{t(ADJUSTMENT_POLICY_LABEL[b.policy])}</td>
                <td><Link href={`/adjustments/${b.id}`}>{t("查看")}</Link></td>
              </tr>
            ))}
            {!batches.length && <tr><td colSpan={8} className="muted">{t("还没有导入过")}</td></tr>}
          </tbody>
        </table>
        <p className="small muted">{t("金额：正数 = ShipBest 向我们补扣 / 向客户补收；负数 = 退款。")}</p>
      </div>
    </>
  );
}
