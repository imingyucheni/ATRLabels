import { notFound } from "next/navigation";
import { currentAdmin } from "@/lib/auth";
import { CUSTOMER_ID_SEGMENT, customerAccess, type AdminPrincipal } from "@/lib/adminSession";
import type { AccessLevel } from "@/lib/staffStore";

/**
 * 客户详情这一组页面（详情、扣款明细、对账单、条款存档）开头调用，不能只靠 proxy：
 * - 客户编号只认纯数字：/customers/5.0、/customers/%35、/customers/0x5 这类写法 Number() 也能转成 5，一律 404；
 * - 自己检查后台登录的人有没有这个客户的权限（员工按授权，公司自用账户员工永远没有），没有就 404。
 */
export async function customerPageAccess(rawId: string): Promise<{ who: AdminPrincipal; id: number; level: AccessLevel }> {
  const who = await currentAdmin();
  if (!who || !CUSTOMER_ID_SEGMENT.test(rawId)) notFound();
  const id = Number(rawId);
  const level = customerAccess(who, id);
  if (!level) notFound();
  return { who, id, level };
}
