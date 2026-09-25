"use client";

import { useActionState } from "react";
import { portalLoginAction } from "../actions";

export default function PortalLoginForm() {
  const [state, action, pending] = useActionState(portalLoginAction, null);
  // 登录失败后表单会被重置，把邮箱带回来，只需重新输入密码
  const email = state?.email ?? "";
  return (
    <form action={action} style={{ display: "grid", gap: 12 }}>
      {state?.error && <div className="alert err">{state.error}</div>}
      <label className="f">
        邮箱
        <input key={email} type="email" name="email" autoComplete="username" defaultValue={email} autoFocus={!email} required />
      </label>
      <label className="f">
        密码
        <input type="password" name="password" autoComplete="current-password" autoFocus={!!email} required />
      </label>
      <button className="primary" disabled={pending}>{pending ? "登录中…" : "登录"}</button>
    </form>
  );
}
