import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { listDraftRows } from "@/lib/batch";
import { money } from "@/lib/pricing";

const LABEL: Record<string, [string, string]> = {
  pending: ["试算中", "pending"],
  quoted: ["待提交", ""],
  error: ["有错误", "exception"],
  failed: ["下单失败", "exception"],
};

export default async function DraftsPage() {
  const me = await requireCustomer();
  const rows = listDraftRows(me.id);
  const jobs = [...new Map(rows.map((r) => [r.job_id, r])).values()];
  const total = rows.filter((r) => r.status === "quoted").reduce((a, r) => a + (r.price ?? 0), 0);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>待出单</h1>
          <p className="page-sub">已导入、还没提交出单的订单。还没扣款，可以修改渠道、删除；提交后才会扣款出面单。</p>
        </div>
        <Link className="btn primary" href="/portal/batch">导入订单</Link>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="kpi-label">待出单</div><div className="kpi-value">{rows.length}</div></div>
        <div className="kpi"><div className="kpi-label">可提交</div><div className="kpi-value">{rows.filter((r) => r.status === "quoted").length}</div><span className="delta muted">预计 {money(total)}</span></div>
        <div className="kpi"><div className="kpi-label">有错误</div><div className={`kpi-value ${rows.some((r) => r.status === "error" || r.status === "failed") ? "neg" : ""}`}>{rows.filter((r) => r.status === "error" || r.status === "failed").length}</div></div>
      </div>
      {jobs.map((j) => {
        const list = rows.filter((r) => r.job_id === j.job_id);
        return (
          <section className="card table-wrap" key={j.job_id}>
            <div className="card-head">
              <h2>批次 #{j.job_id} · {j.filename}</h2>
              <Link className="btn small primary" href={`/portal/batch?job=${j.job_id}`}>选渠道 / 提交 / 删除 →</Link>
            </div>
            <table>
              <thead><tr><th>行</th><th>自定义单号</th><th>收件人</th><th>已选渠道</th><th className="num">运费</th><th>状态</th></tr></thead>
              <tbody>
                {list.map((r) => {
                  const [label, cls] = LABEL[r.status] ?? [r.status, ""];
                  return (
                    <tr key={r.id}>
                      <td className="muted">{r.row_no}</td>
                      <td>{r.customer_ref ?? "-"}</td>
                      <td className="small">{r.recipient}</td>
                      <td>{r.channel_name ?? "-"}</td>
                      <td className="num">{r.price !== null ? money(r.price) : "-"}</td>
                      <td><span className={`badge ${cls}`}>{label}</span>{r.error && <div className="small neg">{r.error}</div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
      {!rows.length && <div className="card muted">没有待出单的订单。<Link href="/portal/batch">导入订单</Link></div>}
    </>
  );
}
