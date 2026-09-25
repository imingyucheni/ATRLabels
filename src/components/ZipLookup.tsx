"use client";

import { useState, useTransition } from "react";
import { lookupZipAction } from "@/app/actions";
import { useT } from "@/components/I18n";

type Row = Awaited<ReturnType<typeof lookupZipAction>>[number];

export default function ZipLookup() {
  const t = useT();
  const [zip, setZip] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="card">
      <h2>{t("查询邮编")}</h2>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => setRows(await lookupZipAction(zip)));
        }}
      >
        <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder={t("例如 10001")} maxLength={10} style={{ width: 160 }} />
        <button disabled={busy || !zip.trim()}>{t("查询")}</button>
      </form>
      {rows && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="list">
            <thead><tr><th>{t("渠道")}</th><th>{t("ShipBest 最近结果")}</th><th>{t("按邮编表")}</th><th>{t("分区")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code}>
                  <td>{r.name}{!r.enabled && <span className="small muted"> · {t("已停用")}</span>}</td>
                  <td>{r.blocked ? <span className="badge exception">{t("不通邮（{date}）", { date: r.blocked.checkedAt.slice(0, 10) })}</span> : <span className="muted small">{t("未记录（试算时查询）")}</span>}</td>
                  <td>
                    {r.result === null ? <span className="muted">{t("没有邮编表")}</span>
                      : r.result.covered ? <span className="badge labeled">{t("在表内")}</span>
                      : <span className="badge pending">{t("不在表内")}</span>}
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
