"use client";

import { useT } from "@/components/I18n";

/** “全部设为”按钮：把表格里的下拉框一起改成某个值（只改表单，保存后才生效） */
export default function SetAllSelects({ selector, options }: { selector: string; options: [string, string][] }) {
  const t = useT();
  return (
    <div className="row" style={{ gap: 8, margin: "8px 0" }}>
      <span className="small muted">{t("全部设为：")}</span>
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className="small"
          onClick={() =>
            document.querySelectorAll<HTMLSelectElement>(selector).forEach((s) => {
              s.value = value;
              s.dispatchEvent(new Event("change", { bubbles: true }));
            })
          }
        >
          {t(label)}
        </button>
      ))}
    </div>
  );
}
