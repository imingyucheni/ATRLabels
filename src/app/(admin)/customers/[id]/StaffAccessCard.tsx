import Link from "next/link";
import FlashForm from "@/components/FlashForm";
import { customerLevel, getStaff, listStaff } from "@/lib/staffStore";
import { getT } from "@/lib/prefs";
import { setCustomerStaffAction } from "@/app/staffActions";

/** 客户详情（主管理员）：这个客户哪些员工能看、能操作 */
export default async function StaffAccessCard({ customerId }: { customerId: number }) {
  const t = await getT();
  const staff = listStaff();
  if (!staff.length) return null;
  return (
    <FlashForm action={setCustomerStaffAction} submitLabel="保存员工权限" className="card" review>
      <div className="card-head">
        <h2 style={{ margin: 0 }}>{t("员工权限")}</h2>
        <Link href="/staff" className="small">{t("管理员工账号")}</Link>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>{t("哪些员工能看到这个客户、能不能操作（改资料、设置邮费、确认充值）。")}</p>
      <input type="hidden" name="customerId" value={customerId} />
      <div className="grid">
        {staff.map((s) => (
          <label key={s.id} className="f">
            {s.name}{!s.active && <span className="small muted"> · {t("已停用")}</span>}
            <select name={`s.${s.id}`} defaultValue={customerLevel(getStaff(s.id), customerId) ?? "none"}>
              <option value="edit">{t("能操作")}</option>
              <option value="view">{t("只能看")}</option>
              <option value="none">{t("看不到")}</option>
            </select>
          </label>
        ))}
      </div>
    </FlashForm>
  );
}
