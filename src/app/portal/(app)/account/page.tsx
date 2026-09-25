import { requireCustomer } from "@/lib/auth";
import FlashForm from "@/components/FlashForm";
import SenderBook from "@/components/SenderBook";
import { listSenders } from "@/lib/senders";
import { portalChangePasswordAction, portalSaveLabelPaperAction, portalSaveNotifyAction } from "@/app/portal/actions";
import { getNotifyPrefs, NOTIFY_EVENTS, NOTIFY_LABEL, notifyReady } from "@/lib/notify";
import { PAPER_LABEL, PAPER_SIZES } from "@/lib/labelLayout";
import { getT } from "@/lib/prefs";

export default async function PortalAccount() {
  const me = await requireCustomer();
  const t = await getT();
  return (
    <>
      <h1>{t("账户设置")}</h1>
      <div className="card">
        <dl className="kv">
          <dt>{t("公司 / 名称")}</dt><dd>{me.name}</dd>
          <dt>{t("登录邮箱")}</dt><dd>{me.portalEmail}</dd>
        </dl>
      </div>
      <FlashForm action={portalSaveLabelPaperAction} submitLabel={t("保存")} className="card">
        <h2>{t("面单纸张")}</h2>
        <p className="small muted">{t("默认 4×6 英寸热敏纸（热敏标签打印机）。用普通办公打印机的话，可以选 8.5×5.5 半张纸或 8.5×11 整张纸，打印后裁剪贴上。打印、下载、合并打印都按这里的设置。")}</p>
        <div className="row" style={{ marginBottom: 12 }}>
          <select name="labelPaper" defaultValue={me.labelPaper || "4x6"} style={{ maxWidth: 320 }}>
            {PAPER_SIZES.map((p) => <option key={p} value={p}>{t(PAPER_LABEL[p])}</option>)}
          </select>
        </div>
      </FlashForm>
      <SenderBook initial={listSenders(me.id)} />
      {notifyReady() && (() => {
        const np = getNotifyPrefs(me.id);
        return (
          <FlashForm action={portalSaveNotifyAction} submitLabel={t("保存")} className="card" id="notify">
            <h2>{t("邮件通知")}</h2>
            <p className="small muted">{t("勾选想收到的邮件，不需要的可以取消。每封邮件底部也有一键退订链接。")}</p>
            <div className="check-grid" style={{ margin: "10px 0" }}>
              {NOTIFY_EVENTS.map((e) => (
                <label key={e} className="small"><input type="checkbox" name={`ev.${e}`} defaultChecked={np.events[e]} /> {t(NOTIFY_LABEL[e])}</label>
              ))}
            </div>
            <div className="grid" style={{ marginBottom: 12 }}>
              <label className="f">{t("收通知的邮箱（可选）")}<input name="notifyEmail" type="email" defaultValue={np.email} placeholder={me.portalEmail ?? ""} /></label>
              <label className="f">{t("余额低于多少美元时提醒")}<input name="lowBalance" type="number" min={0} step={1} defaultValue={np.lowBalance} /></label>
            </div>
          </FlashForm>
        );
      })()}
      <FlashForm action={portalChangePasswordAction} submitLabel={t("修改密码")} className="card" resetOnSuccess>
        <h2>{t("修改密码")}</h2>
        <div className="grid" style={{ marginBottom: 12 }}>
          <label className="f">{t("当前密码")}<input type="password" name="current" required autoComplete="current-password" /></label>
          <label className="f">{t("新密码（至少 8 位）")}<input type="password" name="next" required minLength={8} autoComplete="new-password" /></label>
          <label className="f">{t("确认新密码")}<input type="password" name="confirm" required minLength={8} autoComplete="new-password" /></label>
        </div>
      </FlashForm>
    </>
  );
}
