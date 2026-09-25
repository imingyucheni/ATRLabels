import { STATUS_LABEL, type ShipmentStatus } from "@/lib/db";

export default function StatusBadge({ status }: { status: ShipmentStatus }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}
