import Link from "next/link";
import { getT } from "@/lib/prefs";
import { hasFinancePin } from "@/lib/financePin";
import { currentAdmin } from "@/lib/auth";
import { getStaff } from "@/lib/staffStore";

/**
 * 确认密码输入框（4 位数字）。
 * 主管理员输“设置 → 财务确认密码”；员工输自己在“我的账号”里设的确认密码。还没设置时提示去设置。
 */
export default async function PinField({ compact }: { compact?: boolean }) {
  const t = await getT();
  const who = await currentAdmin();
  const staff = who?.role === "staff";
  const set = staff ? !!getStaff(who.id)?.pinHash : hasFinancePin();
  if (!set) {
    return (
      <div className="alert warn small" style={{ margin: "6px 0" }}>
        {staff ? t("还没有设置你的 4 位确认密码，") : t("还没有设置财务确认密码，")}
        <Link href={staff ? "/account" : "/settings#finance-pin"}>{t("去设置")}</Link>
      </div>
    );
  }
  return (
    <label className="f pin-field" style={compact ? { width: 130 } : { maxWidth: 200 }}>
      <span className="req">{staff ? t("我的确认密码") : t("财务确认密码")}</span>
      <input name="financePin" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="off" placeholder="••••" />
    </label>
  );
}
