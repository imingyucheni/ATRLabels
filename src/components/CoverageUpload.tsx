"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import FilePick from "@/components/FilePick";
import { importCoverageAction, parseCoverageAction } from "@/app/actions";
import type { CoverageSheet } from "@/lib/coverage";

export default function CoverageUpload(props: { gateway: string; channels: { code: string; name: string }[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ token: string; gateway: string; sheets: CoverageSheet[] } | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});

  return (
    <div className="card">
      <h2>上传邮编表</h2>
      {notice && <div className="alert ok">{notice}</div>}
      {error && <div className="alert err">{error}</div>}
      {!preview ? (
        <form
          className="row"
          style={{ alignItems: "end" }}
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setNotice(null);
            const fd = new FormData(e.currentTarget);
            start(async () => {
              const r = await parseCoverageAction(fd);
              if (r.error) return setError(r.error);
              setPreview(r.preview!);
              setMap(Object.fromEntries(r.preview!.sheets.map((s) => [s.sheet, s.guess ?? ""])));
            });
          }}
        >
          <label className="f">服务商报价表（.xlsx，自动读取名字带“邮编”的工作表）<FilePick name="file" accept=".xlsx" required /></label>
          <label className="f" style={{ width: 140 }}>发货口岸<input name="gateway" defaultValue={props.gateway} maxLength={10} /></label>
          <button className="primary" disabled={busy}>{busy ? "读取中…" : "读取"}</button>
          <span className="small muted">从 91710（Chino）发货对应 LAX。文件较大时读取需要几秒。</span>
        </form>
      ) : (
        <>
          <p className="small muted">口岸 {preview.gateway}。确认每张邮编表对应的渠道（选“不导入”则跳过）；同一渠道原来的邮编表会被替换。</p>
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>工作表</th><th>识别方式</th><th className="num">可派送邮编</th><th>示例</th><th>对应渠道</th></tr></thead>
              <tbody>
                {preview.sheets.map((s) => (
                  <tr key={s.sheet}>
                    <td>{s.sheet}</td>
                    <td className="small">{s.error ? <span style={{ color: "var(--err)" }}>{s.error}</span> : s.how}</td>
                    <td className="num">{s.count.toLocaleString()}</td>
                    <td className="small muted">{s.sample.join(", ")}</td>
                    <td>
                      <select value={map[s.sheet] ?? ""} disabled={!s.count} onChange={(e) => setMap({ ...map, [s.sheet]: e.target.value })}>
                        <option value="">不导入</option>
                        {props.channels.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="primary"
              disabled={busy || !Object.values(map).some(Boolean)}
              onClick={() =>
                start(async () => {
                  const r = await importCoverageAction(preview.token, map);
                  if (r.error) return setError(r.error);
                  setPreview(null);
                  setNotice(`已导入 ${r.done!.length} 个渠道的邮编表（共 ${r.done!.reduce((a, d) => a + d.count, 0).toLocaleString()} 个邮编）`);
                  router.refresh();
                })
              }
            >
              确认导入
            </button>
            <button onClick={() => setPreview(null)} disabled={busy}>取消</button>
          </div>
        </>
      )}
    </div>
  );
}
