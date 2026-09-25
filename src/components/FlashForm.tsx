"use client";

import { useActionState } from "react";
import type { FlashState } from "@/app/actions";

/** 通用表单：提交 Server Action 并显示成功/失败提示。 */
export default function FlashForm({
  action,
  children,
  submitLabel,
  className,
  submitClass = "primary",
  confirm,
  inline,
}: {
  action: (state: FlashState, fd: FormData) => Promise<FlashState>;
  children?: React.ReactNode;
  submitLabel: string;
  className?: string;
  submitClass?: string;
  confirm?: string;
  inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className={className}
      style={inline ? { display: "inline-block" } : undefined}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {state?.ok && <div className="alert ok">{state.ok}</div>}
      {state?.error && <div className="alert err">{state.error}</div>}
      {children}
      <button className={submitClass} disabled={pending}>
        {pending ? "处理中…" : submitLabel}
      </button>
    </form>
  );
}
