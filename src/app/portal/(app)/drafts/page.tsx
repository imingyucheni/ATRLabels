import Link from "next/link";
import ChannelLabel from "@/components/ChannelLabel";
import { requireCustomer } from "@/lib/auth";
import { listDraftRows } from "@/lib/batch";
import { money } from "@/lib/pricing";
import { makeT, translateMessage } from "@/lib/i18n";
import { getLang } from "@/lib/prefs";

const LABEL: Record<string, [string, string]> = {
  pending: ["试算中", "pending"],
  quoted: ["待提交", ""],
  error: ["有错误", "exception"],
  failed: ["下单失败", "exception"],
};

export default async function DraftsPage() {
  const me = await requireCustomer();
  const lang = await getLang();
  const t = makeT(lang);
  // 一行错误可能是多条用“；”连起来的，逐条翻译（中文界面原样显示）
  const tr = (m: string) => (lang === "en" ? m.split("；").map((p) => {
    const x = p.match(/^(所有渠道都无法报价|下单失败|处理出错)：([\s\S]+)$/);
    return x ? `${t(x[1])}: ${translateMessage(lang, x[2])}` : translateMessage(lang, p);
  }).join("; ") : m);
  const rows = listDraftRows(me.id);
  const jobs = [...new Map(rows.map((r) => [r.job_id, r])).values()];
  const total = rows.filter((r) => r.status === "quoted").reduce((a, r) => a + (r.price ?? 0), 0);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("待出单")}</h1>
          <p className="page-sub">{t("已导入、还没提交出单的订单。还没扣款，可以修改渠道、删除；提交后才会扣款出面单。")}</p>
        </div>
        <Link className="btn primary" href="/portal/batch">{t("导入订单")}</Link>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="kpi-label">{t("待出单")}</div><div className="kpi-value">{rows.length}</div></div>
        <div className="kpi"><div className="kpi-label">{t("可提交")}</div><div className="kpi-value">{rows.filter((r) => r.status === "quoted").length}</div><span className="delta muted">{t("预计 {amount}", { amount: money(total) })}</span></div>
        <div className="kpi"><div className="kpi-label">{t("有错误")}</div><div className={`kpi-value ${rows.some((r) => r.status === "error" || r.status === "failed") ? "neg" : ""}`}>{rows.filter((r) => r.status === "error" || r.status === "failed").length}</div></div>
      </div>
      {jobs.map((j) => {
        const list = rows.filter((r) => r.job_id === j.job_id);
        return (
          <section className="card table-wrap" key={j.job_id}>
            <div className="card-head">
              <h2>{j.filename || t("批量导入")}</h2>
              <Link className="btn small primary" href={`/portal/batch?job=${j.job_id}`}>{t("选渠道 / 提交 / 删除 →")}</Link>
            </div>
            <table>
              <thead><tr><th>{t("行")}</th><th>{t("自定义单号")}</th><th>{t("收件人")}</th><th>{t("已选渠道")}</th><th className="num">{t("运费")}</th><th>{t("状态")}</th></tr></thead>
              <tbody>
                {list.map((r) => {
                  const [label, cls] = LABEL[r.status] ?? [r.status, ""];
                  return (
                    <tr key={r.id}>
                      <td className="muted">{r.row_no}</td>
                      <td>{r.customer_ref ?? "-"}</td>
                      <td className="small">{r.recipient}</td>
                      <td>{r.channel_name ? <ChannelLabel name={r.channel_name} /> : "-"}</td>
                      <td className="num">{r.price !== null ? money(r.price) : "-"}</td>
                      <td><span className={`badge ${cls}`}>{t(label)}</span>{r.error && <div className="small neg">{tr(r.error)}</div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
      {!rows.length && <div className="card muted">{t("没有待出单的订单。")}<Link href="/portal/batch">{t("导入订单")}</Link></div>}
    </>
  );
}
