"use client";

import { useActionState, useEffect, useRef, startTransition } from "react";
import type { FlashState } from "@/app/actions";

/**
 * 通用表单：提交 Server Action 并显示成功/失败提示。
 * 不用 <form action>，避免 React 提交后自动清空表单（出错时用户输入会丢失）；
 * 需要成功后清空的表单（充值金额、密码）传 resetOnSuccess。
 */
export default function FlashForm({
  action,
  children,
  submitLabel,
  className,
  submitClass = "primary",
  confirm,
  inline,
  resetOnSuccess,
  id,
}: {
  action: (state: FlashState, fd: FormData) => Promise<FlashState>;
  children?: React.ReactNode;
  submitLabel: string;
  className?: string;
  submitClass?: string;
  confirm?: string;
  inline?: boolean;
  resetOnSuccess?: boolean;
  id?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      id={id}
      className={className}
      style={inline ? { display: "inline-block" } : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
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
