import { STATUS_LABEL, type ShipmentStatus } from "@/lib/db";
import { getT } from "@/lib/prefs";

export default async function StatusBadge({ status }: { status: ShipmentStatus }) {
  const t = await getT();
  return <span className={`badge ${status}`}>{STATUS_LABEL[status] ? t(STATUS_LABEL[status]) : status}</span>;
}
