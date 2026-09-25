import Link from "next/link";
import { getT } from "@/lib/prefs";
import { hasFinancePin } from "@/lib/financePin";

/** 财务确认密码输入框（4 位数字）；还没设置时提示去设置 */
export default async function PinField({ compact }: { compact?: boolean }) {
  const t = await getT();
  if (!hasFinancePin()) {
    return (
      <div className="alert warn small" style={{ margin: "6px 0" }}>
        {t("还没有设置财务确认密码，")}<Link href="/settings#finance-pin">{t("去设置")}</Link>
      </div>
    );
  }
  return (
    <label className="f pin-field" style={compact ? { width: 130 } : { maxWidth: 200 }}>
      <span className="req">{t("财务确认密码")}</span>
      <input name="financePin" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="off" placeholder="••••" />
    </label>
  );
}
