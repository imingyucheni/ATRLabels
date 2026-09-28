"use client";

import { useT } from "@/components/I18n";

/** 打印当前页面（浏览器里可以选“另存为 PDF”） */
export default function PrintButton({ label = "打印 / 保存 PDF" }: { label?: string }) {
  const t = useT();
  return <button type="button" className="primary" onClick={() => window.print()}>{t(label)}</button>;
}
