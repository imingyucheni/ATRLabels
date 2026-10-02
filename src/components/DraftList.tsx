"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { FileClock } from "lucide-react";
import { useT } from "@/components/I18n";
import { deleteDraftAction, type DraftScope } from "@/app/draftActions";

export interface DraftRow {
  id: number;
  title: string;
  time: string;
  /** 继续填写的链接（国内 / 国际下单页面 + ?draft=ID） */
  href: string;
}

/** 下单页上方的草稿列表：继续填写 / 删除。没有草稿时不显示 */
export default function DraftList({ drafts, scope, currentId }: { drafts: DraftRow[]; scope: DraftScope; currentId?: number }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const [busy, start] = useTransition();
  if (!drafts.length) return null;
  const shown = all ? drafts : drafts.slice(0, 5);
  return (
    <div className="card draft-list">
      <div className="draft-head">
        <FileClock size={16} aria-hidden="true" />
        <b>{t("草稿（{n}）", { n: drafts.length })}</b>
        <span className="small muted">{t("没确认出单的订单，点“继续填写”接着下单；出单成功后草稿自动删除")}</span>
      </div>
      <ul>
        {shown.map((d) => (
          <li key={d.id} className={d.id === currentId ? "on" : ""}>
            <span className="draft-title">{d.title === "未填收件人" ? t(d.title) : d.title}</span>
            <span className="small muted">{t("保存于 {time}", { time: d.time })}</span>
            <span className="draft-act">
              {d.id === currentId ? <span className="small muted">{t("正在填写")}</span> : <Link href={d.href}>{t("继续填写")}</Link>}
              <button
                type="button"
                className="small link-btn"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(t("删除这份草稿？删除后不能恢复。"))) return;
                  start(async () => {
                    await deleteDraftAction({ scope, id: d.id });
                  });
                }}
              >
                {t("删除")}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {drafts.length > 5 && (
        <button type="button" className="small link-btn" onClick={() => setAll((v) => !v)}>
          {all ? t("收起") : t("显示全部 {n} 个", { n: drafts.length })}
        </button>
      )}
    </div>
  );
}
