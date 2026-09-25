"use client";

import { useState } from "react";

/** 带勾选的表格：勾选多张已出面单，一键合并打印 */
export default function SelectPrint({
  rows,
  headers,
  numericCols = [],
}: {
  rows: { id: number; hasLabel: boolean; cells: React.ReactNode[] }[];
  headers: string[];
  numericCols?: number[];
}) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const printable = rows.filter((r) => r.hasLabel);
  const toggle = (id: number) => setSel((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const all = printable.length > 0 && printable.every((r) => sel.has(r.id));
  return (
    <div className="card table-wrap">
      <div className="row" style={{ marginBottom: 8 }}>
        <a
          className={`btn ${sel.size ? "primary" : ""}`}
          href={sel.size ? `/api/labels/merge?ids=${[...sel].join(",")}` : undefined}
          target="_blank"
          aria-disabled={!sel.size}
          style={sel.size ? undefined : { opacity: 0.5, pointerEvents: "none" }}
        >
          合并打印所选面单（{sel.size}）
        </a>
        <span className="small muted">勾选已出面单的记录，合并成一个 4×6 PDF 打印</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <input type="checkbox" checked={all} onChange={() => setSel(all ? new Set() : new Set(printable.map((r) => r.id)))} aria-label="全选" />
            </th>
            {headers.map((h, i) => <th key={h} className={numericCols.includes(i) ? "num" : ""}>{h}</th>)}
            <th>面单</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.hasLabel && <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label="选择" />}</td>
              {r.cells.map((c, i) => <td key={i} className={numericCols.includes(i) ? "num" : ""}>{c}</td>)}
              <td>{r.hasLabel ? <a href={`/api/labels/${r.id}`} target="_blank">打印</a> : "-"}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={headers.length + 2} className="muted">没有记录</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
