"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <div className="login card">
      <h1>ATR 面单系统</h1>
      <form action={action} style={{ display: "grid", gap: 12 }}>
        {state?.error && <div className="alert err">{state.error}</div>}
        <label className="f">
          后台密码
          <input type="password" name="password" autoFocus required />
        </label>
        <button className="primary" disabled={pending}>
          {pending ? "登录中…" : "登录"}
        </button>
      </form>
    </div>
  );
}
