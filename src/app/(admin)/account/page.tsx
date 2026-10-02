import Link from "next/link";
import FlashForm from "@/components/FlashForm";
import { requireAdmin } from "@/lib/auth";
import { getStaff } from "@/lib/staffStore";
import { getT } from "@/lib/prefs";
import { changeMyPasswordAction, setMyPinAction } from "@/app/staffActions";

export const dynamic = "force-dynamic";

/** 员工自己的账号：设置 4 位确认密码（确认充值用）、改登录密码 */
export default async function MyAccountPage() {
  const who = await requireAdmin({ staff: true });
  const t = await getT();
  if (who.role === "owner") {
    return (
      <>
        <h1>{t("我的账号")}</h1>
        <div className="card">
          <p>{t("你是主管理员。主管理员的确认密码在")} <Link href="/settings#finance-pin">{t("设置 → 财务确认密码")}</Link>{t("；员工账号在")} <Link href="/staff">{t("员工账号")}</Link> {t("里管理。")}</p>
        </div>
      </>
    );
  }
  const me = getStaff(who.id)!;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("我的账号")}</h1>
          <p className="page-sub">{t("{name} · 登录名 {u}", { name: me.name, u: me.username })}</p>
        </div>
      </div>
      {!me.pinHash && <div className="alert warn">{t("还没有设置确认密码。确认客户充值时要输入它，请先在下面设置。")}</div>}

      <FlashForm action={setMyPinAction} submitLabel={me.pinHash ? "修改确认密码" : "设置确认密码"} className="card" resetOnSuccess>
        <h2 style={{ marginTop: 0 }}>{t("4 位确认密码")}</h2>
        <p className="small muted" style={{ marginTop: -4 }}>{t("确认客户充值时输入，防止别人用你登录着的电脑操作。充值记录里会记下是你确认的。")}</p>
        <div className="grid">
          <label className="f"><span className="req">{t("新的确认密码（4 位数字）")}</span><input name="pin" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="off" /></label>
          <label className="f"><span className="req">{t("再输一次")}</span><input name="pin2" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="off" /></label>
          <label className="f"><span className="req">{t("登录密码（验证身份）")}</span><input name="password" type="password" required autoComplete="current-password" /></label>
        </div>
      </FlashForm>

      <FlashForm action={changeMyPasswordAction} submitLabel="修改登录密码" className="card" resetOnSuccess>
        <h2 style={{ marginTop: 0 }}>{t("登录密码")}</h2>
        <div className="grid">
          <label className="f"><span className="req">{t("原密码")}</span><input name="old" type="password" required autoComplete="current-password" /></label>
          <label className="f"><span className="req">{t("新密码（至少 8 位）")}</span><input name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
          <label className="f"><span className="req">{t("再输一次")}</span><input name="password2" type="password" required minLength={8} autoComplete="new-password" /></label>
        </div>
        <p className="small muted">{t("改完后需要用新密码重新登录。忘记密码请找主管理员重置。")}</p>
      </FlashForm>
    </>
  );
}
