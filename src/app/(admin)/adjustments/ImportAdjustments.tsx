"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { importAdjustmentAction, parseAdjustmentFileAction, previewAdjustmentAction } from "@/app/actions";
import type { Mapping, ParsedSheet, Preview } from "@/lib/adjustments";
import { money } from "@/lib/pricing";
import { guessColumns as guess } from "@/lib/sheetGuess";

/** 0 -> A, 25 -> Z, 26 -> AA, 51 -> AZ（和 Excel 一致） */
function colLetter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export default function ImportAdjustments() {
  const router = useRouter();
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [onlyProblems, setOnlyProblems] = useState(false);

  const header = useMemo(() => (sheet && mapping ? sheet.rows[mapping.headerRow] ?? [] : []), [sheet, mapping]);
  const colOptions = header.map((h, i) => ({ i, label: `${colLetter(i)}列：${h || "(空)"}` }));

  function onFile(fd: FormData) {
    setError(null);
    setPreview(null);
    start(async () => {
      const r = await parseAdjustmentFileAction(fd);
      if (r.error || !r.sheet) {
        setError(r.error ?? "读取失败");
        setSheet(null);
        return;
      }
      setSheet(r.sheet);
      setMapping({ headerRow: r.sheet.headerRow, ...guess(r.sheet.rows[r.sheet.headerRow] ?? []), positiveMeans: "charge" });
    });
  }

  function update(patch: Partial<Mapping>) {
    setMapping((m) => {
      const next = { ...m!, ...patch };
      if (patch.headerRow !== undefined && sheet) Object.assign(next, guess(sheet.rows[patch.headerRow] ?? []));
      return next;
    });
    setPreview(null);
  }

  function onPreview() {
    setError(null);
    start(async () => {
      const r = await previewAdjustmentAction(sheet!.rows, mapping!);
      if (r.error) setError(r.error);
      setPreview(r.preview ?? null);
    });
  }

  function onImport() {
    if (!preview) return;
    const msg =
      `确认导入？\n有效 ${preview.rows.length - preview.invalid} 行，其中 ${preview.unmatched} 行未匹配到面单（会保存，之后可手动关联）。` +
      (preview.duplicates ? `\n\n⚠ 有 ${preview.duplicates} 行在对应面单上已经有相同金额的补差，可能是重复导入！` : "");
    if (!window.confirm(msg)) return;
    start(async () => {
      const r = await importAdjustmentAction({ filename: sheet!.filename, rows: sheet!.rows, mapping: mapping!, note });
      if (r.error) return setError(r.error);
      router.push(`/adjustments/${r.batchId}`);
    });
  }

  const rows = preview?.rows.filter((r) => !onlyProblems || r.error || !r.shipmentId || r.possibleDuplicate) ?? [];

  return (
    <div className="card">
      <h2>上传补差表格</h2>
      <form action={onFile} className="row">
        <input type="file" name="file" accept=".xlsx,.csv" required style={{ maxWidth: 360 }} />
        <button disabled={busy}>{busy && !sheet ? "读取中…" : "读取表格"}</button>
        <span className="small muted">支持 .xlsx / .csv（旧版 .xls 请先另存为 .xlsx）</span>
      </form>

      {error && <div className="alert err" style={{ marginTop: 12 }}>{error}</div>}

      {sheet && mapping && (
        <>
          {sheet.alreadyImported && <div className="alert warn" style={{ marginTop: 12 }}>这个文件之前已经导入过，不能重复导入。</div>}
          <h3>对应列（{sheet.filename}，共 {sheet.rows.length} 行）</h3>
          <div className="grid">
            <label className="f">表头在第几行
              <select value={mapping.headerRow} onChange={(e) => update({ headerRow: Number(e.target.value) })}>
                {sheet.rows.slice(0, 15).map((r, i) => <option key={i} value={i}>第 {i + 1} 行：{r.filter(Boolean).slice(0, 3).join(" | ").slice(0, 40)}</option>)}
              </select>
            </label>
            <label className="f"><span className="req">单号列（运单号 / 单号）</span>
              <select value={mapping.keyCol} onChange={(e) => update({ keyCol: Number(e.target.value) })}>
                <option value={-1}>请选择</option>
                {colOptions.map((c) => <option key={c.i} value={c.i}>{c.label}</option>)}
              </select>
            </label>
            <label className="f">备用单号列（可选，例如“客户单号”）
              <select value={mapping.altKeyCol} onChange={(e) => update({ altKeyCol: Number(e.target.value) })}>
                <option value={-1}>无</option>
                {colOptions.map((c) => <option key={c.i} value={c.i}>{c.label}</option>)}
              </select>
            </label>
            <label className="f"><span className="req">补差金额列</span>
              <select value={mapping.amountCol} onChange={(e) => update({ amountCol: Number(e.target.value) })}>
                <option value={-1}>请选择</option>
                {colOptions.map((c) => <option key={c.i} value={c.i}>{c.label}</option>)}
              </select>
            </label>
            <label className="f">原因 / 备注列（可选）
              <select value={mapping.reasonCol} onChange={(e) => update({ reasonCol: Number(e.target.value) })}>
                <option value={-1}>无</option>
                {colOptions.map((c) => <option key={c.i} value={c.i}>{c.label}</option>)}
              </select>
            </label>
            <label className="f">金额为正数表示
              <select value={mapping.positiveMeans} onChange={(e) => update({ positiveMeans: e.target.value as Mapping["positiveMeans"] })}>
                <option value="charge">ShipBest 向我们补扣（少补）</option>
                <option value="refund">ShipBest 退给我们（多退）</option>
              </select>
            </label>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={onPreview} disabled={busy || sheet.alreadyImported}>{busy ? "处理中…" : "预览匹配结果"}</button>
          </div>
        </>
      )}

      {preview && (
        <>
          {preview.duplicates > 0 && (
            <div className="alert warn" style={{ marginTop: 12 }}>
              ⚠ 有 {preview.duplicates} 行在对应面单上已经有相同金额的补差记录，可能这张表之前已经导入过。请在下方勾选“只看有问题的行”核对后再导入。
            </div>
          )}
          <h3>按客户汇总</h3>
          <div className="stats">
            <div className="stat"><div className="muted">ShipBest 补差合计</div><div className="v">{money(preview.costTotal)}</div></div>
            <div className="stat"><div className="muted">已匹配</div><div className="v">{preview.rows.length - preview.unmatched - preview.invalid}</div></div>
            <div className="stat"><div className="muted">未匹配</div><div className={`v ${preview.unmatched ? "profit-neg" : ""}`}>{preview.unmatched}</div></div>
            <div className="stat"><div className="muted">金额无法识别（跳过）</div><div className={`v ${preview.invalid ? "profit-neg" : ""}`}>{preview.invalid}</div></div>
          </div>
          <table>
            <thead><tr><th>客户</th><th className="num">单数</th><th className="num">ShipBest 补差</th><th className="num">向客户补收(+)/退(-)</th></tr></thead>
            <tbody>
              {preview.byCustomer.map((g) => (
                <tr key={g.customerId}><td>{g.customerName}</td><td className="num">{g.count}</td><td className="num">{money(g.costTotal)}</td><td className="num"><b>{money(g.customerTotal)}</b></td></tr>
              ))}
              {!preview.byCustomer.length && <tr><td colSpan={4} className="muted">没有匹配到任何面单</td></tr>}
            </tbody>
          </table>

          <div className="row" style={{ justifyContent: "space-between", margin: "16px 0 8px" }}>
            <h3 style={{ margin: 0 }}>明细</h3>
            <label className="small"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> 只看有问题的行</label>
          </div>
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
            <table>
              <thead><tr><th>行</th><th>单号</th><th>原始金额</th><th className="num">ShipBest 补差</th><th>面单 / 客户</th><th className="num">向客户</th><th>说明</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowNo}>
                    <td className="muted">{r.rowNo}</td>
                    <td>{r.matchKey}</td>
                    <td className="muted">{r.rawAmount}</td>
                    <td className="num">{money(r.costAmount)}</td>
                    <td>
                      {r.error ? <span className="profit-neg">{r.error}</span> : r.shipmentId ? <>{r.customNo}<div className="small muted">{r.customerName}</div></> : <span className="profit-neg">未找到面单</span>}
                      {r.possibleDuplicate && <div className="small" style={{ color: "var(--warn)" }}>⚠ 该单已有相同金额的补差，可能重复</div>}
                    </td>
                    <td className="num">{money(r.customerAmount)}</td>
                    <td className="small">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <input placeholder="批次备注（可选），例如：2026年9月账单" value={note} onChange={(e) => setNote(e.target.value)} style={{ maxWidth: 360 }} />
            <button className="primary" onClick={onImport} disabled={busy || preview.rows.length === preview.invalid}>确认导入</button>
          </div>
        </>
      )}
    </div>
  );
}
