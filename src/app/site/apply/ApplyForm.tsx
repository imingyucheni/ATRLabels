"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useT, useTMsg } from "@/components/I18n";
import { applyAction } from "../actions";

export default function ApplyForm({ volumes }: { volumes: string[] }) {
  const t = useT();
  const tMsg = useTMsg();
  const [state, action, pending] = useActionState(applyAction, null);
  if (state?.ok) {
    return (
      <div className="site-apply-done">
        <CheckCircle2 size={40} />
        <h2>{t("已收到你的申请")}</h2>
        <p>{t("我们会尽快通过你留下的联系方式联系你。")}</p>
      </div>
    );
  }
  return (
    <form action={action} className="site-apply-form">
      <h2>{t("填写联系方式")}</h2>
      {state?.error && <div className="alert err">{tMsg(state.error)}</div>}
      <label className="f"><span className="req">{t("公司 / 店铺名称")}</span><input name="company" required maxLength={80} defaultValue={state?.values?.company} /></label>
      <label className="f"><span className="req">{t("联系人")}</span><input name="contact" required maxLength={40} defaultValue={state?.values?.contact} /></label>
      <div className="grid2 tight">
        <label className="f">{t("微信")}<input name="wechat" maxLength={40} defaultValue={state?.values?.wechat} /></label>
        <label className="f">{t("电话")}<input name="phone" type="tel" maxLength={30} defaultValue={state?.values?.phone} /></label>
      </div>
      <label className="f">{t("邮箱")}<input name="email" type="email" maxLength={80} defaultValue={state?.values?.email} /></label>
      <label className="f">{t("预计每月单量")}
        <select name="volume" defaultValue={state?.values?.volume ?? ""}>
          <option value="">{t("请选择")}</option>
          {volumes.map((v) => <option key={v} value={v}>{t(v)}</option>)}
        </select>
      </label>
      <label className="f">{t("备注（常用渠道、发货地等）")}<textarea name="note" rows={3} maxLength={500} defaultValue={state?.values?.note} /></label>
      {/* 防机器人：正常人看不到这个输入框 */}
      <input name="website" tabIndex={-1} autoComplete="off" className="hp" aria-hidden="true" />
      <p className="small muted">{t("微信、电话、邮箱至少填一个，方便我们联系你。")}</p>
      <button className="primary lg" disabled={pending}>{pending ? t("提交中…") : t("提交申请")}</button>
    </form>
  );
}
