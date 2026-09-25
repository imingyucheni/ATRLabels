"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";
import { useT, useTMsg } from "@/components/I18n";

export default function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  const t = useT();
  const tm = useTMsg();
  return (
    <form action={action}>
      {state?.error && <div className="alert err">{tm(state.error)}</div>}
      <label className="f">{t("后台密码")}<input type="password" name="password" autoComplete="current-password" autoFocus required /></label>
      <button className="primary" disabled={pending}>{pending ? t("登录中…") : t("登录")}</button>
    </form>
  );
}
