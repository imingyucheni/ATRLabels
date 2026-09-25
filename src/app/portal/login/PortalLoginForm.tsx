"use client";

import { useActionState } from "react";
import { portalLoginAction } from "../actions";
import { useT, useTMsg } from "@/components/I18n";

export default function PortalLoginForm() {
  const t = useT();
  const tMsg = useTMsg();
  const [state, action, pending] = useActionState(portalLoginAction, null);
  // 登录失败后表单会被重置，把邮箱带回来，只需重新输入密码
  const email = state?.email ?? "";
  return (
    <form action={action} style={{ display: "grid", gap: 12 }}>
      {state?.error && <div className="alert err">{tMsg(state.error)}</div>}
      <label className="f">
        {t("邮箱")}
        <input key={email} type="email" name="email" autoComplete="username" defaultValue={email} autoFocus={!email} required />
      </label>
      <label className="f">
        {t("密码")}
        <input type="password" name="password" autoComplete="current-password" autoFocus={!!email} required />
      </label>
      <button className="primary" disabled={pending}>{t(pending ? "登录中…" : "登录")}</button>
    </form>
  );
}
