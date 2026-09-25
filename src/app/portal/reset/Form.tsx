"use client";

import { useActionState } from "react";
import { portalResetAction } from "../actions";
import { useT, useTMsg } from "@/components/I18n";

export default function ResetForm({ token }: { token: string }) {
  const t = useT();
  const tMsg = useTMsg();
  const [state, action, pending] = useActionState(portalResetAction, null);
  return (
    <form action={action}>
      {state?.error && <div className="alert err">{tMsg(state.error)}</div>}
      <input type="hidden" name="token" value={token} />
      <label className="f">{t("新密码（至少 8 位）")}<input type="password" name="password" minLength={8} required autoComplete="new-password" autoFocus /></label>
      <label className="f">{t("确认新密码")}<input type="password" name="confirm" minLength={8} required autoComplete="new-password" /></label>
      <button className="primary" disabled={pending}>{t(pending ? "保存中…" : "设置新密码并登录")}</button>
    </form>
  );
}
