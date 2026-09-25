"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action}>
      {state?.error && <div className="alert err">{state.error}</div>}
      <label className="f">后台密码<input type="password" name="password" autoComplete="current-password" autoFocus required /></label>
      <button className="primary" disabled={pending}>{pending ? "登录中…" : "登录"}</button>
    </form>
  );
}
