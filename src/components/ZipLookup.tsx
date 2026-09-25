"use client";

import { useState, useTransition } from "react";
import { lookupZipAction } from "@/app/actions";

type Row = Awaited<ReturnType<typeof lookupZipAction>>[number];

export default function ZipLookup() {
  const [zip, setZip] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="card">
      <h2>查询邮编</h2>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => setRows(await lookupZipAction(zip)));
        }}
      >
        <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="例如 10001" maxLength={10} style={{ width: 160 }} />
        <button disabled={busy || !zip.trim()}>查询</button>
      </form>
      {rows && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="list">
            <thead><tr><th>渠道</th><th>ShipBest 最近结果</th><th>按邮编表</th><th>分区</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code}>
                  <td>{r.name}{!r.enabled && <span className="small muted"> · 已停用</span>}</td>
                  <td>{r.blocked ? <span className="badge exception">不通邮（{r.blocked.checkedAt.slice(0, 10)}）</span> : <span className="muted small">未记录（试算时查询）</span>}</td>
                  <td>
                    {r.result === null ? <span className="muted">没有邮编表</span>
                      : r.result.covered ? <span className="badge labeled">在表内</span>
                      : <span className="badge pending">不在表内</span>}
                  </td>
                  <td>{r.result?.zone ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
