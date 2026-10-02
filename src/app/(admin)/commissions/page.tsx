import Link from "next/link";
import FlashForm from "@/components/FlashForm";
import { salesSummaries } from "@/lib/commission";
import { money } from "@/lib/pricing";
import { localDate } from "@/lib/reports";
import { getT } from "@/lib/prefs";
import { saveSalesAction } from "@/app/commissionActions";

export const dynamic = "force-dynamic";

/** 销售佣金：销售名单、每人本期佣金和未结算金额 */
export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const t = await getT();
  const sp = await searchParams;
  const today = localDate();
  const from = sp.from || `${today.slice(0, 8)}01`;
  const to = sp.to || today;
  const rows = salesSummaries(from, to);
  const sum = (k: "orders" | "profit" | "commission" | "due") => rows.reduce((a, r) => a + r[k], 0);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("销售佣金")}</h1>
          <p className="page-sub">{t("客户归属到销售后，这个客户的所有订单按利润 × 佣金比例给销售算佣金。比例按客户定：在销售详情里添加客户时填，或在客户详情 → 渠道与价格里设置。")}</p>
        </div>
      </div>

      <form className="card row" method="get">
        <label className="f">{t("开始日期")}<input type="date" name="from" defaultValue={from} /></label>
        <label className="f">{t("结束日期")}<input type="date" name="to" defaultValue={to} /></label>
        <button className="primary">{t("查看")}</button>
      </form>

      <div className="card table-wrap">
        <table className="card-table">
          <thead>
            <tr><th>{t("销售")}</th><th>{t("联系方式")}</th><th className="num">{t("默认比例")}</th><th className="num">{t("客户数")}</th><th className="num">{t("订单")}</th><th className="num">{t("利润")}</th><th className="num">{t("本期佣金")}</th><th className="num">{t("未结算（全部）")}</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rep.id} className={r.rep.active ? "" : "muted"}>
                <td className="c-main"><Link href={`/commissions/${r.rep.id}`}>{r.rep.name}</Link>{!r.rep.active && <> <span className="badge">{t("已停用")}</span></>}</td>
                <td className="small" data-label={t("联系方式")}>{[r.rep.phone, r.rep.email].filter(Boolean).join(" · ") || "-"}</td>
                <td className="num" data-label={t("默认比例")}>{r.rep.rate === null ? <span className="muted">{t("按客户")}</span> : `${r.rep.rate}%`}</td>
                <td className="num" data-label={t("客户数")}>{r.customers}</td>
                <td className="num" data-label={t("订单")}>{r.orders}{r.noRate > 0 && <div className="small warn-text">{t("{n} 单未设比例", { n: r.noRate })}</div>}</td>
                <td className={`num ${r.profit < 0 ? "profit-neg" : ""}`} data-label={t("利润")}>{money(r.profit)}</td>
                <td className="num" data-label={t("本期佣金")}><b>{money(r.commission)}</b></td>
                <td className={`num ${r.due > 0 ? "warn-text" : ""}`} data-label={t("未结算（全部）")}>{money(r.due)}</td>
                <td className="c-act"><Link href={`/commissions/${r.rep.id}?from=${from}&to=${to}`}>{t("明细 / 结算")}</Link></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="muted">{t("还没有销售，先在下面添加")}</td></tr>}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr><td colSpan={4}><b>{t("合计")}</b></td><td className="num">{sum("orders")}</td><td className="num">{money(sum("profit"))}</td><td className="num"><b>{money(sum("commission"))}</b></td><td className="num">{money(sum("due"))}</td><td></td></tr>
            </tfoot>
          )}
        </table>
      </div>

      <FlashForm action={saveSalesAction} submitLabel="添加销售" className="card" resetOnSuccess>
        <h2 style={{ marginTop: 0 }}>{t("添加销售")}</h2>
        <div className="grid">
          <label className="f"><span className="req">{t("姓名")}</span><input name="name" required maxLength={60} /></label>
          <label className="f">{t("默认佣金比例 %（选填）")}<input name="rate" type="number" min="0" max="100" step="0.01" placeholder={t("一般按客户设，可以不填")} /></label>
          <label className="f">{t("电话")}<input name="phone" type="tel" maxLength={40} /></label>
          <label className="f">{t("邮箱")}<input name="email" type="email" maxLength={120} /></label>
          <label className="f" style={{ gridColumn: "1 / -1" }}>{t("备注")}<input name="note" maxLength={200} placeholder={t("例如 收款账户、合作开始时间")} /></label>
        </div>
      </FlashForm>
      <p className="small muted">{t("添加销售后，到销售详情里添加客户并填每个客户的佣金比例。")} {t("佣金 = 单票利润 × 比例。利润和报表一致：客户价 − 成本 + 补差，取消单算取消手续费差额；亏损单按比例冲减；异常单、内部测试单不算。")}</p>
    </>
  );
}
