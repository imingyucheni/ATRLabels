"use client";

import { useState } from "react";
import { PAPER_LABEL, PAPER_SIZES, type PaperSize } from "@/lib/labelLayout";
import { useT } from "@/components/I18n";

/**
 * 面单打印 / 下载：默认用账户设置的纸张，这一次可以临时换成别的纸张（不改账户设置）。
 * extra：后台额外的按钮（例如原始面单）。
 */
export default function LabelActions({ id, defaultPaper, preview = true, extra }: { id: number; defaultPaper: PaperSize; preview?: boolean; extra?: React.ReactNode }) {
  const t = useT();
  const [paper, setPaper] = useState<PaperSize>(defaultPaper);
  const q = `?paper=${paper}`;
  return (
    <>
      <div className="row label-actions" style={{ marginBottom: 12 }}>
        <label className="f" style={{ minWidth: 220, margin: 0 }}>
          <span className="small muted">{t("纸张")}</span>
          <select value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)}>
            {PAPER_SIZES.map((p) => (
              <option key={p} value={p}>{t(PAPER_LABEL[p])}{p === defaultPaper ? t("（账户默认）") : ""}</option>
            ))}
          </select>
        </label>
        <a className="btn primary" href={`/api/labels/${id}${q}`} target="_blank">{t("打开 / 打印")}</a>
        <a className="btn" href={`/api/labels/${id}${q}&download=1`}>{t("下载 PDF")}</a>
        {extra}
      </div>
      {preview && (
        <iframe key={paper} src={`/api/labels/${id}${q}`} style={{ width: "100%", height: 480, border: "1px solid var(--line)", borderRadius: 8 }} />
      )}
    </>
  );
}
