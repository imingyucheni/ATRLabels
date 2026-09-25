"use client";

import { useState } from "react";
import { useT } from "@/components/I18n";

/** 导出 CSV：默认只导订单信息，勾选后才带上运费、手续费、退回、补差 */
export default function ExportCsv({ qs }: { qs: string }) {
  const t = useT();
  const [fees, setFees] = useState(false);
  return (
    <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
      <label className="small nowrap" title={t("运费、取消手续费、退回、补差")}>
        <input type="checkbox" checked={fees} onChange={(e) => setFees(e.target.checked)} /> {t("包含费用")}
      </label>
      <a className="btn" href={`/api/portal/export?${qs}${fees ? `${qs ? "&" : ""}fees=1` : ""}`}>{t("导出 CSV")}</a>
    </span>
  );
}
