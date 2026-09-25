import { STATUS_LABEL, type ShipmentStatus } from "@/lib/db";
import { getT } from "@/lib/prefs";

/** 订单状态；test = 模拟 / 沙盒模式下的测试单（面单不是真的），旁边加一个“测试”标记 */
export default async function StatusBadge({ status, test }: { status: ShipmentStatus; test?: boolean }) {
  const t = await getT();
  const badge = <span className={`badge ${status}`}>{STATUS_LABEL[status] ? t(STATUS_LABEL[status]) : status}</span>;
  if (!test) return badge;
  return (
    <span className="badge-pair">
      {badge}
      <span className="badge test" title={t("模拟 / 沙盒模式下的测试单，面单不能真实使用")}>{t("测试")}</span>
    </span>
  );
}
