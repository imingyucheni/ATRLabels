"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { confirmBatchJobAction, createBatchJobAction, deleteBatchJobAction, getBatchJobAction, type BatchJobView } from "@/app/batchActions";
import { JOB_STATUS_LABEL } from "@/lib/batchLabels";
import { money } from "@/lib/pricing";

const ROW_STATUS: Record<string, [string, string]> = {
  pending: ["待报价", "pending"],
  quoted: ["已报价", ""],
  error: ["有错误", "exception"],
  created: ["已下单", "labeled"],
  failed: ["下单失败", "exception"],
};

export default function BatchOrders(props: {
  mode: "admin" | "portal";
  customers?: { id: number; name: string }[];
  channels: { code: string; name: string }[];
  jobId?: number;
  basePath: string;
}) {
  const router = useRouter();
  const [job, setJob] = useState<BatchJobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [onlyProblems, setOnlyProblems] = useState(false);

  const load = useCallback(async (id: number) => {
    const r = await getBatchJobAction(id);
    if (r.error) setError(r.error);
    else setJob(r.job!);
  }, []);

  useEffect(() => {
    if (props.jobId) load(props.jobId);
    else setJob(null);
  }, [props.jobId, load]);

  // 任务状态变化时刷新页面其余部分（侧栏余额、最近批次）
  const status = job?.status;
  useEffect(() => {
    if (status === "ready" || status === "done") router.refresh();
  }, [status, router]);

  // 后台处理中时每 2 秒刷新进度
  useEffect(() => {
    if (!job || !["quoting", "creating", "labeling"].includes(job.status)) return;
    const t = setTimeout(() => load(job.id), 2000);
    return () => clearTimeout(t);
  }, [job, load]);

  function onUpload(fd: FormData) {
    setError(null);
    start(async () => {
      const r = await createBatchJobAction(fd);
      if (r.error) return setError(r.error);
      router.push(`${props.basePath}?job=${r.jobId}`);
    });
  }

  function onConfirm() {
    if (!job) return;
    const quoted = job.rows.filter((r) => r.status === "quoted");
    const total = quoted.reduce((a, r) => a + (r.price ?? 0), 0);
    const warn = total > job.available ? `\n\n⚠ 可用余额 ${money(job.available)} 不够全部下单，余额用完会自动暂停。` : "";
    if (!window.confirm(`确认下单 ${quoted.length} 单，合计 ${money(total)}（从${props.mode === "portal" ? "账户" : "客户"}余额扣除）？${warn}`)) return;
    start(async () => {
      const r = await confirmBatchJobAction(job.id);
      if (r.error) setError(r.error);
      await load(job.id);
    });
  }

  function onDelete() {
    if (!job || !window.confirm("放弃这个批次？")) return;
    start(async () => {
      const r = await deleteBatchJobAction(job.id);
      if (r.error) return setError(r.error);
      router.push(props.basePath);
    });
  }

  if (!props.jobId) {
    return (
      <div className="card">
        <h2>上传订单表格</h2>
        <ol className="small muted" style={{ paddingLeft: 18, marginTop: 0 }}>
          <li>下载 <a href="/api/batch/template">批量下单模板（Excel）</a>，按说明填写。同一个订单号的多行会合并成一单（多个 SKU）。</li>
          <li>上传后系统会逐单查询运费，确认合计金额后再下单。</li>
          <li>下单完成后可以一键合并打印全部 4×6 面单。</li>
        </ol>
        <form action={onUpload} className="grid" style={{ alignItems: "end" }}>
          {props.mode === "admin" && (
            <label className="f"><span className="req">客户</span>
              <select name="customerId" required>
                {props.customers?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          <label className="f">渠道
            <select name="channelMode" defaultValue="cheapest">
              <option value="cheapest">每单自动选最便宜</option>
              {props.channels.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </label>
          <label className="f" style={{ gridColumn: "span 2" }}><span className="req">文件（.xlsx / .csv）</span>
            <input type="file" name="file" accept=".xlsx,.csv" required />
          </label>
          <button className="primary" disabled={busy}>{busy ? "上传中…" : "上传并报价"}</button>
        </form>
        {error && <div className="alert err" style={{ marginTop: 12 }}>{error}</div>}
      </div>
    );
  }

  if (!job) return <div className="card">{error ? <div className="alert err">{error}</div> : "加载中…"}</div>;

  const count = (st: string) => job.rows.filter((r) => r.status === st).length;
  const quoted = job.rows.filter((r) => r.status === "quoted");
  const quotedTotal = quoted.reduce((a, r) => a + (r.price ?? 0), 0);
  const created = job.rows.filter((r) => r.status === "created");
  const createdTotal = created.reduce((a, r) => a + (r.price ?? 0), 0);
  const labeled = created.filter((r) => r.hasLabel);
  const working = ["quoting", "creating", "labeling"].includes(job.status);
  const done = job.rows.filter((r) => r.status !== "pending" && !(job.status === "creating" && r.status === "quoted")).length;
  const rows = job.rows.filter((r) => !onlyProblems || r.status === "error" || r.status === "failed" || r.error);

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>
            批次 #{job.id} · {job.filename}{props.mode === "admin" ? ` · ${job.customerName}` : ""} ·{" "}
            <span className={`badge ${job.status === "done" ? "labeled" : working ? "pending" : ""}`}>{JOB_STATUS_LABEL[job.status]}</span>
          </h2>
          <a href={props.basePath}>＋ 新的批量下单</a>
        </div>
        {working && (
          <p className="muted">
            {job.status === "quoting" ? "正在逐单查询运费" : job.status === "creating" ? "正在逐单下单" : "正在等待面单生成"}… {done}/{job.rows.length}
            （可以离开这个页面，稍后回来查看）
          </p>
        )}
        {job.error && <div className="alert warn">{job.error}</div>}
        {error && <div className="alert err">{error}</div>}
        <div className="stats" style={{ marginTop: 12 }}>
          <div className="stat"><div className="muted">订单数</div><div className="v">{job.rows.length}</div></div>
          <div className="stat"><div className="muted">待下单</div><div className="v">{quoted.length}</div><div className="small muted">合计 {money(quotedTotal)}</div></div>
          <div className="stat"><div className="muted">已下单</div><div className="v">{created.length}</div><div className="small muted">合计 {money(createdTotal)}</div></div>
          <div className="stat"><div className="muted">有问题</div><div className={`v ${count("error") + count("failed") ? "profit-neg" : ""}`}>{count("error") + count("failed")}</div></div>
          <div className="stat"><div className="muted">{props.mode === "portal" ? "账户可用余额" : "客户可用余额"}</div><div className={`v ${job.available < quotedTotal ? "profit-neg" : ""}`}>{money(job.available)}</div></div>
        </div>
        <div className="row">
          {job.status === "ready" && quoted.length > 0 && (
            <button className="primary" onClick={onConfirm} disabled={busy}>
              {created.length ? "继续下单" : "确认下单"} {quoted.length} 单（{money(quotedTotal)}）
            </button>
          )}
          {labeled.length > 0 && (
            <a className="btn primary" href={`/api/labels/merge?ids=${labeled.map((r) => r.shipmentId).join(",")}`} target="_blank">
              合并打印 {labeled.length} 张面单
            </a>
          )}
          {job.status === "ready" && created.length === 0 && <button className="danger" onClick={onDelete} disabled={busy}>放弃这个批次</button>}
          <label className="small" style={{ marginLeft: "auto" }}>
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> 只看有问题的
          </label>
        </div>
        {count("error") > 0 && job.status === "ready" && (
          <p className="small muted">有错误的订单不会下单。请在表格里改好后，把这些订单重新上传一个新批次。</p>
        )}
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>行</th><th>订单号</th><th>收件人</th><th>渠道</th><th className="num">运费</th><th>状态</th><th>运单号 / 说明</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const [label, cls] = ROW_STATUS[r.status];
              return (
                <tr key={r.id}>
                  <td className="muted">{r.rowNo}</td>
                  <td>{r.customerRef ?? "-"}</td>
                  <td className="small">{r.recipient}</td>
                  <td>{r.channelName ?? "-"}</td>
                  <td className="num">{r.price !== null ? money(r.price, r.currency ?? "") : "-"}</td>
                  <td><span className={`badge ${cls}`}>{label}</span></td>
                  <td className="small">
                    {r.shipmentId ? (
                      <>
                        <a href={`${props.mode === "portal" ? "/portal" : ""}/shipments/${r.shipmentId}`}>{r.trackingNo ?? "查看"}</a>
                        {r.hasLabel ? " · " : ""}
                        {r.hasLabel && <a href={`/api/labels/${r.shipmentId}`} target="_blank">面单</a>}
                      </>
                    ) : null}
                    {r.error && <div style={{ color: r.status === "quoted" ? "var(--warn)" : "var(--err)" }}>{r.error}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
