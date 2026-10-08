"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useT } from "@/components/I18n";

/** 小的复制按钮（例如运单号旁边）：点一下复制，图标变成对勾 */
export default function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const t = useT();
  return (
    <button
      type="button"
      className="copy-btn"
      title={copied ? t("已复制") : t(label)}
      aria-label={t(label)}
      onClick={async (e) => {
        // 在表格行里（可以勾选的行）点复制，不要连带触发行的点击
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // 没有 https 等情况下剪贴板接口不能用：退回老办法
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}
