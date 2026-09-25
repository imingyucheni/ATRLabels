"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  chooseAllAction,
  chooseRowAction,
  confirmBatchJobAction,
  deleteRowsAction,
  createBatchJobAction,
  deleteBatchJobAction,
  getBatchJobAction,
  requoteAction,
  setSelectedAction,
  type BatchJobView,
} from "@/app/batchActions";
import { JOB_STATUS_LABEL } from "@/lib/batchLabels";
import { money } from "@/lib/pricing";
import FilePick from "@/components/FilePick";
import { useLang, useT } from "@/components/I18n";
import { translateMessage } from "@/lib/i18n";

const ROW_STATUS: Record<string, [string, string]> = {
  pending: ["试算中", "pending"],
  quoted: ["待提交", ""],
  error: ["有错误", "exception"],
  created: ["已下单", "labeled"],
  failed: ["下单失败", "exception"],
};

/** 渠道送不到这个地址（不通邮 / 不在派送范围） */
const uncovered = (e?: string | null) => /不通邮|派送范围|未覆盖/.test(e ?? "");

/** 翻译服务器返回的提示：一行错误可能是多条用“；”连起来的，逐条翻译（中文界面原样显示） */
function useTrMsg() {
  const lang = useLang();
  const t = useT();
  return (m?: string | null) => {
    if (!m || lang !== "en") return m ?? "";
    return m
      .split("；")
      .map((p) => {
        const x = p.match(/^(所有渠道都无法报价|下单失败|处理出错)：([\s\S]+)$/);
        return x ? `${t(x[1])}: ${translateMessage(lang, x[2])}` : translateMessage(lang, p);
      })
      .join("; ");
  };
}

export default function BatchOrders(props: {
  mode: "admin" | "portal";
  /** 后台：客户列表，每个客户带自己已开通的渠道 */
  customers?: { id: number; name: string; channels: { code: string; name: string }[] }[];
  /** 客户端：当前客户已开通的渠道 */
  channels?: { code: string; name: string }[];
  jobId?: number;
  basePath: string;
}) {
  const router = useRouter();
  const t = useT();
  const tr = useTrMsg();
  const [job, setJob] = useState<BatchJobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [onlyProblems, setOnlyProblems] = useState(false);
  // 和 ShipBest 一样：默认只显示能送达（可下单）的渠道
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [requoteSet, setRequoteSet] = useState<Set<string>>(new Set());
  const [bulkChannel, setBulkChannel] = useState("");
  const [custId, setCustId] = useState<number | undefined>(undefined);
  const channelsOf = (id?: number) =>
    props.mode === "admin" ? props.customers?.find((c) => c.id === id)?.channels ?? [] : props.channels ?? [];
  const uploadChannels = channelsOf(custId);

  const load = useCallback(async (id: number) => {
    const r = await getBatchJobAction(id);
    // 批次里的订单都删掉后批次也会删除，回到导入页
    if (r.error === "任务不存在") return router.push(props.basePath);
    if (r.error) setError(r.error);
    else {
      setJob(r.job!);
      setRequoteSet((s) => (s.size ? s : new Set(r.job!.channels.map((c) => c.code))));
    }
  }, [router, props.basePath]);

  useEffect(() => {
    if (props.jobId) load(props.jobId);
    else setJob(null);
  }, [props.jobId, load]);

  // 后台处理中时每 2 秒刷新进度
  useEffect(() => {
    const labelsPending = job?.rows.some((r) => r.labelPending);
    if (!job || (!["quoting", "creating", "labeling"].includes(job.status) && !labelsPending)) return;
    const t = setTimeout(() => load(job.id), labelsPending && job.status === "ready" ? 4000 : 2000);
    return () => clearTimeout(t);
  }, [job, load]);

  // 任务状态变化时刷新页面其余部分（侧栏余额、最近批次）
  const status = job?.status;
  useEffect(() => {
    if (status === "ready" || status === "done") router.refresh();
  }, [status, router]);

  function act(fn: () => Promise<{ error?: string; message?: string }>) {
    setError(null);
    setNotice(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      if (r.message) setNotice(r.message);
      if (job) await load(job.id);
    });
  }

  /** 先在页面上立即更新（选渠道、勾选），再等服务器保存，避免点了没反应的感觉 */
  function patchRows(fn: (r: BatchJobView["rows"][number]) => Partial<BatchJobView["rows"][number]> | null) {
    setJob((j) => (j ? { ...j, rows: j.rows.map((r) => ({ ...r, ...(fn(r) ?? {}) })) } : j));
  }

  function onUpload(fd: FormData) {
    setError(null);
    start(async () => {
      const r = await createBatchJobAction(fd);
      if (r.error) return setError(r.error);
      router.push(`${props.basePath}?job=${r.jobId}`);
    });
  }

  /* ---------- 上传 ---------- */
  if (!props.jobId) {
    return (
      <div className="card">
        <div className="card-head">
          <h2>{t("导入订单")}</h2>
          <a className="btn" href="/api/batch/template" download>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></svg>
            {t("下载导单模板")}
          </a>
        </div>
        <ol className="small muted" style={{ paddingLeft: 18, marginTop: 0 }}>
          <li>{t("使用")} <b>{t("ShipBest 导单模板")}</b>{t("：原来在 ShipBest 后台用的表格可以直接上传，也可以点右上角下载模板（含填写说明和示例）。寄件人各列留空时，使用{who}。", { who: props.mode === "portal" ? t("账户设置里的默认寄件地址") : t("客户的默认寄件地址") })}</li>
          <li>{t("系统用下面勾选的渠道逐单试算，每单列出各渠道价格，默认选最便宜的，可以逐单修改。")}</li>
          <li>{t("确认后勾选订单“提交订单”，完成后一键合并打印全部面单（纸张在“账户设置”里选，默认 4×6）。")}</li>
        </ol>
        <form action={onUpload} style={{ display: "grid", gap: 12 }}>
          <input type="hidden" name="mode" value={props.mode} />
          <div className="grid" style={{ alignItems: "end" }}>
            {props.mode === "admin" && (
              <label className="f"><span className="req">{t("客户")}</span>
                <select name="customerId" required value={custId ?? ""} onChange={(e) => setCustId(Number(e.target.value))}>
                  <option value="" disabled>{t("请选择客户")}</option>
                  {props.customers?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
            <label className="f">{t("默认选择")}
              <select name="pickMode" defaultValue="cheapest">
                <option value="cheapest">{t("每单选最便宜的渠道")}</option>
                <option value="file">{t("按表格里的物流产品（没有报价时选最便宜）")}</option>
              </select>
            </label>
            <label className="f" style={{ gridColumn: "span 2" }}><span className="req">{t("文件（.xlsx / .csv）")}</span>
              <FilePick name="file" accept=".xlsx,.csv" required />
            </label>
          </div>
          <div>
            <div className="small muted" style={{ marginBottom: 4 }}>{t("试算渠道（渠道越多试算越慢）")}</div>
            <div className="row" style={{ gap: 14 }} key={custId}>
              {uploadChannels.map((c) => (
                <label key={c.code} className="small"><input type="checkbox" name="channels" value={c.code} defaultChecked /> {c.name}</label>
              ))}
              {!uploadChannels.length && (
                <span className="small" style={{ color: "var(--warn)" }}>
                  {props.mode === "admin" ? (custId ? t("这个客户还没有开通任何渠道，请先到“客户”详情里开通。") : t("请先选择客户。")) : t("您的账户还没有开通物流渠道，请联系客服开通。")}
                </span>
              )}
            </div>
          </div>
          <div><button className="primary" disabled={busy || !uploadChannels.length}>{busy ? t("导入中…") : t("导入并试算")}</button></div>
        </form>
        {error && <div className="alert err" style={{ marginTop: 12 }}>{tr(error)}</div>}
      </div>
    );
  }

  if (!job) return <div className="card">{error ? <div className="alert err">{tr(error)}</div> : t("加载中…")}</div>;

  /* ---------- 任务 ---------- */
  const editable = job.status === "ready";
  const working = ["quoting", "creating", "labeling"].includes(job.status);
  const quoted = job.rows.filter((r) => r.status === "quoted");
  const chosen = quoted.filter((r) => r.selected && r.channelCode);
  const total = chosen.reduce((a, r) => a + (r.price ?? 0), 0);
  const created = job.rows.filter((r) => r.status === "created");
  const createdTotal = created.reduce((a, r) => a + (r.price ?? 0), 0);
  const labeled = created.filter((r) => r.hasLabel);
  const problems = job.rows.filter((r) => r.status === "error" || r.status === "failed").length;
  const dupes = quoted.filter((r) => r.warning).length;
  const processed = job.rows.filter((r) => r.status !== "pending").length;
  const allSelected = quoted.length > 0 && quoted.every((r) => r.selected);
  const rows = job.rows.filter((r) => !onlyProblems || r.status === "error" || r.status === "failed" || r.error || (r.warning && r.status === "quoted"));
  const cheapestTotal = chosen.reduce((a, r) => a + Math.min(...r.quotes.filter((q) => q.ok).map((q) => q.price!)), 0);

  function onSubmit() {
    const warn = total > job!.available
      ? job!.balanceRule === "positive"
        ? "\n\n⚠ " + t("可用余额 {amount} 不够全部提交。余额大于 0 时会继续出单，最后一单可能让余额变成负数（下次充值时抵扣）；余额 ≤ 0 时自动暂停，充值后可以继续提交。", { amount: money(job!.available) })
        : "\n\n⚠ " + t("可用余额 {amount} 不够全部提交，不够付下一单时会自动暂停，充值后可以继续提交。", { amount: money(job!.available) })
      : "";
    if (!window.confirm(t(props.mode === "portal" ? "提交 {n} 单，预计应付 {amount}（从账户余额扣除）？" : "提交 {n} 单，预计应付 {amount}（从客户余额扣除）？", { n: chosen.length, amount: money(total) }) + warn)) return;
    act(() => confirmBatchJobAction(job!.id));
  }

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>
            {props.mode === "admin" ? `${t("批次")} #${job.id} · ` : `${t("批次")} · `}{job.filename}{props.mode === "admin" ? ` · ${job.customerName}` : ""} ·{" "}
            <span className={`badge ${job.status === "done" ? "labeled" : working ? "pending" : ""}`}>{t(JOB_STATUS_LABEL[job.status])}</span>
          </h2>
          <a href={props.basePath}>{t("＋ 导入新的订单")}</a>
        </div>
        {working && (
          <p className="muted">
            {job.status === "quoting" ? t("正在用 {n} 个渠道逐单试算", { n: job.channels.length }) : job.status === "creating" ? t("正在逐单提交") : t("正在等待面单生成")}…
            {job.status === "quoting" ? ` ${processed}/${job.rows.length}` : ""}{t("（可以离开这个页面，稍后回来查看）")}
          </p>
        )}
        {job.error && <div className="alert warn">{tr(job.error)}</div>}
        {error && <div className="alert err">{tr(error)}</div>}
        {notice && <div className="alert ok">{tr(notice)}</div>}

        <div className="stats" style={{ marginTop: 12 }}>
          <div className="stat"><div className="muted">{t("订单数")}</div><div className="v">{job.rows.length}</div></div>
          <div className="stat"><div className="muted">{t("已勾选待提交")}</div><div className="v">{chosen.length}</div><div className="small muted">{t("预计应付 {amount}", { amount: money(total) })}</div></div>
          <div className="stat"><div className="muted">{t("已下单")}</div><div className="v">{created.length}</div><div className="small muted">{t("合计 {amount}", { amount: money(createdTotal) })}</div></div>
          <div className="stat"><div className="muted">{t("有问题")}</div><div className={`v ${problems ? "profit-neg" : ""}`}>{problems}</div></div>
          <div className="stat"><div className="muted">{props.mode === "portal" ? t("账户可用余额") : t("客户可用余额")}</div><div className={`v ${job.available < total ? "profit-neg" : ""}`}>{money(job.available)}</div></div>
        </div>

        {editable && quoted.length > 0 && (
          <div style={{ display: "grid", gap: 10, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="small muted">{t("勾选的订单：")}</span>
              <button className="small" disabled={busy} onClick={() => act(() => chooseAllAction(job.id, "cheapest", chosen.map((r) => r.id)))}>{t("全部选最便宜")}</button>
              <button className="small" disabled={busy} onClick={() => act(() => chooseAllAction(job.id, "file", chosen.map((r) => r.id)))}>{t("按表格物流产品")}</button>
              <select className="small" style={{ width: "auto" }} value={bulkChannel} onChange={(e) => setBulkChannel(e.target.value)}>
                <option value="">{t("统一改为某个渠道…")}</option>
                {job.channels.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
              <button className="small" disabled={busy || !bulkChannel} onClick={() => act(() => chooseAllAction(job.id, bulkChannel, chosen.map((r) => r.id)))}>{t("应用")}</button>
              <button className="small danger" disabled={busy || !chosen.length} onClick={() => {
                if (window.confirm(t("删除勾选的 {n} 单？删除后不会下单。", { n: chosen.length }))) act(() => deleteRowsAction(job.id, chosen.map((r) => r.id)));
              }}>{t("删除勾选的订单")}</button>
              {problems > 0 && (
                <button className="small" disabled={busy} onClick={() => {
                  const bad = job.rows.filter((r) => r.status === "error" || r.status === "failed").map((r) => r.id);
                  if (window.confirm(t("删除 {n} 单有错误的订单？", { n: bad.length }))) act(() => deleteRowsAction(job.id, bad));
                }}>{t("删除有错误的订单")}</button>
              )}
              {total - cheapestTotal > 0.005 && <span className="small" style={{ color: "var(--warn)" }}>{t("比全部选最便宜多 {amount}", { amount: money(total - cheapestTotal) })}</span>}
            </div>
            <div className="row" style={{ gap: 12 }}>
              <span className="small muted">{t("试算渠道：")}</span>
              {channelsOf(job.customerId).map((c) => (
                <label key={c.code} className="small">
                  <input
                    type="checkbox"
                    checked={requoteSet.has(c.code)}
                    onChange={(e) => setRequoteSet((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(c.code);
                      else n.delete(c.code);
                      return n;
                    })}
                  /> {c.name}
                </label>
              ))}
              <button className="small" disabled={busy || !requoteSet.size} onClick={() => act(() => requoteAction(job.id, [...requoteSet]))}>{t("重新试算")}</button>
            </div>
          </div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          {editable && quoted.length > 0 && (
            <button className="primary" onClick={onSubmit} disabled={busy || !chosen.length}>
              {t("提交订单（{n} 单 · 预计应付 {amount}）", { n: chosen.length, amount: money(total) })}
            </button>
          )}
          {labeled.length > 0 && (
            <a className="btn primary" href={`/api/labels/merge?ids=${labeled.map((r) => r.shipmentId).join(",")}`} target="_blank">
              {t("合并打印 {n} 张面单", { n: labeled.length })}
            </a>
          )}
          {editable && created.length === 0 && (
            <button className="danger" disabled={busy} onClick={() => {
              if (!window.confirm(t("放弃这个批次？"))) return;
              start(async () => {
                const r = await deleteBatchJobAction(job.id);
                if (r.error) return setError(r.error);
                router.push(props.basePath);
              });
            }}>{t("放弃这个批次")}</button>
          )}
          <label className="small" style={{ marginLeft: "auto" }}>
            <input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} /> {t("只显示可下单渠道")}
          </label>
          <label className="small">
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> {t("只看有问题的订单")}
          </label>
        </div>
        {dupes > 0 && editable && (
          <div className="alert warn">⚠ {t("{n} 单的订单号之前已经出过面单（或在别的批次里待提交），可能是重复导入，已默认不勾选。确认需要重复出单的，再手动勾选提交。", { n: dupes })}</div>
        )}
        {problems > 0 && editable && <p className="small muted">{t("有错误的订单不会提交。请在表格里改好后，把这些订单重新导入。")}</p>}
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                {editable && quoted.length > 0 && (
                  <input
                    type="checkbox"
                    aria-label={t("全选")}
                    checked={allSelected}
                    disabled={busy}
                    onChange={() => {
                      patchRows((x) => (x.status === "quoted" ? { selected: !allSelected } : null));
                      act(() => setSelectedAction(job.id, allSelected ? "none" : "all"));
                    }}
                  />
                )}
              </th>
              <th>{t("行")}</th><th>{t("自定义单号")}</th><th>{t("收件人")}</th><th>{t("包裹")}</th><th style={{ minWidth: 300 }}>{t("物流产品 / 价格")}</th><th>{t("状态")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const [label, cls] = r.labelPending ? [t("已扣款 · 面单生成中"), "pending"] : [t(ROW_STATUS[r.status][0]), ROW_STATUS[r.status][1]];
              const rowEditable = editable && r.status === "quoted";
              return (
                <tr key={r.id} className={r.warning && r.status === "quoted" ? "row-warn" : undefined}>
                  <td>
                    {rowEditable && (
                      <input
                        type="checkbox"
                        aria-label={t("选择")}
                        checked={r.selected}
                        disabled={busy}
                        onChange={() => {
                          patchRows((x) => (x.id === r.id ? { selected: !r.selected } : null));
                          act(() => setSelectedAction(job.id, quoted.filter((x) => (x.id === r.id ? !x.selected : x.selected)).map((x) => x.id)));
                        }}
                      />
                    )}
                  </td>
                  <td className="muted">{r.rowNo}</td>
                  <td>{r.customerRef ?? "-"}{r.fileChannel && <div className="small muted">{t("表格：")}{r.fileChannel}</div>}</td>
                  <td className="small">{r.recipient}</td>
                  <td className="small">{r.pkg}</td>
                  <td>
                    {r.status === "created" || r.status === "failed" ? (
                      <span>{r.channelName} <b>{r.price !== null ? money(r.price, r.currency ?? "") : ""}</b></span>
                    ) : r.quotes.length ? (
                      <div style={{ display: "grid", gap: 2 }}>
                        {r.quotes.filter((q) => q.ok || !onlyAvailable).map((q) => (
                          <label
                            key={q.code}
                            className="small"
                            title={q.ok ? "" : tr(q.error)}
                            style={{ display: "flex", justifyContent: "space-between", gap: 12, opacity: q.ok ? 1 : 0.5, cursor: rowEditable && q.ok ? "pointer" : "default" }}
                          >
                            <span>
                              <input
                                type="radio"
                                name={`ch-${r.id}`}
                                checked={r.channelCode === q.code}
                                disabled={!rowEditable || !q.ok || busy}
                                onChange={() => {
                                  patchRows((x) => (x.id === r.id ? { channelCode: q.code, channelName: q.name, price: q.price ?? null, currency: q.currency ?? null } : null));
                                  act(() => chooseRowAction(job.id, r.id, q.code));
                                }}
                              />{" "}
                              {q.name}{q.zone ? <span className="muted"> · {q.zone}</span> : null}
                            </span>
                            <span className="nowrap">
                              {q.ok && props.mode === "admin" && q.cost !== undefined && (
                                <span className="muted" title={t("成本 / 利润")}>{money(q.cost)} · <span className={q.price! - q.cost < 0 ? "profit-neg" : ""}>+{(q.price! - q.cost).toFixed(2)}</span>{" "}</span>
                              )}
                              <b style={q.ok ? undefined : { color: "var(--muted)", fontWeight: 500 }}>{q.ok ? money(q.price, q.currency ?? "") : uncovered(q.error) ? t("地址未覆盖") : t("不可用")}</b>
                            </span>
                          </label>
                        ))}
                        {onlyAvailable && r.quotes.some((q) => !q.ok) && (
                          <span className="small muted" title={r.quotes.filter((q) => !q.ok).map((q) => `${q.name}${t("：")}${q.error ? tr(q.error) : t("不可用")}`).join("\n")}>
                            {t("另有 {n} 个渠道地址未覆盖或不可用（{list}）", { n: r.quotes.filter((q) => !q.ok).length, list: r.quotes.filter((q) => !q.ok).map((q) => q.name).join(t("、")) })}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="muted small">{r.status === "pending" ? t("试算中…") : "-"}</span>
                    )}
                  </td>
                  <td className="small">
                    <span className={`badge ${cls}`}>{label}</span>
                    {r.shipmentId ? (
                      <div>
                        <a href={`${props.mode === "portal" ? "/portal" : ""}/shipments/${r.shipmentId}`}>{r.trackingNo ?? t("查看")}</a>
                        {r.hasLabel && <> · <a href={`/api/labels/${r.shipmentId}`} target="_blank">{t("面单")}</a></>}
                      </div>
                    ) : null}
                    {r.error && <div style={{ color: r.status === "quoted" ? "var(--warn)" : "var(--err)", maxWidth: 260 }}>{tr(r.error)}</div>}
                    {r.warning && r.status !== "created" && <div style={{ color: "var(--warn)", maxWidth: 260 }}>⚠ {tr(r.warning)}</div>}
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
