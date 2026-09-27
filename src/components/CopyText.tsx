"use client";

import { useState } from "react";
import { useT } from "@/components/I18n";

/** 一段可复制的文字（例如发给服务商的问题说明） */
export default function CopyText({ text, label = "复制" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const t = useT();
  return (
    <div>
      <pre className="cred-text">{text}</pre>
      <button
        type="button"
        className="primary small"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
          } catch {
            const ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
          }
          setCopied(true);
        }}
      >
        {copied ? t("已复制 ✓") : t(label)}
      </button>
    </div>
  );
}
