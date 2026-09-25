"use client";

import { useActionState, useEffect, useRef, useState, startTransition } from "react";
import { Lock, PencilLine } from "lucide-react";
import type { FlashState } from "@/app/actions";
import { useT, useTMsg } from "@/components/I18n";

/**
 * 通用表单：提交 Server Action 并显示成功/失败提示。
 * 不用 <form action>，避免 React 提交后自动清空表单（出错时用户输入会丢失）；
 * 需要成功后清空的表单（充值金额、密码）传 resetOnSuccess。
 * 影响全部客户的设置传 locked：默认只读，点“修改”才能编辑，保存前再确认一次，保存成功后重新锁上。
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
  locked,
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
  /** 锁定说明（例如“修改会影响所有客户的价格”）；传了就默认锁定 */
  locked?: string;
}) {
  const t = useT();
  const tMsg = useTMsg();
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState(!locked);

  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
    if (locked && state?.ok) setEditing(false);
  }, [state, resetOnSuccess, locked]);

  if (locked) {
    return (
      <form
        ref={ref}
        id={id}
        className={`${className ?? ""} locked-form${editing ? " editing" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (!editing) return;
          if (!window.confirm(t(confirm ?? "这些设置会影响所有客户，确定保存修改吗？"))) return;
          const fd = new FormData(e.currentTarget);
          startTransition(() => formAction(fd));
        }}
      >
        {state?.ok && <div className="alert ok">{tMsg(state.ok)}</div>}
        {state?.error && <div className="alert err">{tMsg(state.error)}</div>}
        <fieldset disabled={!editing || pending} className="bare">{children}</fieldset>
        <div className="lock-bar">
          {editing ? (
            <>
              <button className={submitClass} disabled={pending}>{pending ? t("处理中…") : t(submitLabel)}</button>
              <button type="button" disabled={pending} onClick={() => { ref.current?.reset(); setEditing(false); }}>{t("取消修改")}</button>
              <span className="small warn-text">{t(locked)}</span>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setEditing(true)}><PencilLine size={14} strokeWidth={2} /> {t("修改")}</button>
              <span className="small muted"><Lock size={12} strokeWidth={2.2} /> {t("已锁定，防止误改")} · {t(locked)}</span>
            </>
          )}
        </div>
      </form>
    );
  }

  return (
    <form
      ref={ref}
      id={id}
      className={className}
      style={inline ? { display: "inline-block" } : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(t(confirm))) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      {state?.ok && <div className="alert ok">{tMsg(state.ok)}</div>}
      {state?.error && <div className="alert err">{tMsg(state.error)}</div>}
      {children}
      <button className={submitClass} disabled={pending}>
        {pending ? t("处理中…") : t(submitLabel)}
      </button>
    </form>
  );
}
