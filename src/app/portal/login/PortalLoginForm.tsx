"use client";

import { useActionState } from "react";
import { portalLoginAction } from "../actions";

export default function PortalLoginForm() {
  const [state, action, pending] = useActionState(portalLoginAction, null);
  return (
    <form action={action} style={{ display: "grid", gap: 12 }}>
      {state?.error && <div className="alert err">{state.error}</div>}
      <label className="f">邮箱<input type="email" name="email" autoComplete="username" autoFocus required /></label>
      <label className="f">密码<input type="password" name="password" autoComplete="current-password" required /></label>
      <button className="primary" disabled={pending}>{pending ? "登录中…" : "登录"}</button>
    </form>
  );
}
