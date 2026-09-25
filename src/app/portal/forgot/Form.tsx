"use client";

import { useActionState } from "react";
import { portalForgotAction } from "../actions";
import { useT, useTMsg } from "@/components/I18n";

export default function ForgotForm() {
  const t = useT();
  const tMsg = useTMsg();
  const [state, action, pending] = useActionState(portalForgotAction, null);
  if (state && "ok" in state && state.ok) return <div className="alert ok">{tMsg(state.ok)}</div>;
  return (
    <form action={action}>
      {state && "error" in state && state.error && <div className="alert err">{tMsg(state.error)}</div>}
      <label className="f">{t("登录邮箱")}<input type="email" name="email" autoFocus required /></label>
      <button className="primary" disabled={pending}>{t(pending ? "提交中…" : "重置密码")}</button>
    </form>
  );
}
