"use client";

import { useActionState } from "react";
import { portalForgotAction } from "../actions";

export default function ForgotForm() {
  const [state, action, pending] = useActionState(portalForgotAction, null);
  if (state && "ok" in state && state.ok) return <div className="alert ok">{state.ok}</div>;
  return (
    <form action={action}>
      {state && "error" in state && state.error && <div className="alert err">{state.error}</div>}
      <label className="f">登录邮箱<input type="email" name="email" autoFocus required /></label>
      <button className="primary" disabled={pending}>{pending ? "提交中…" : "重置密码"}</button>
    </form>
  );
}
