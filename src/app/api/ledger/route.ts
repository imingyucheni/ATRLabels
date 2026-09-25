import { isLoggedIn } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { LEDGER_TYPE_LABEL, listLedger } from "@/lib/ledger";

export async function GET(req: Request) {
  if (!(await isLoggedIn())) return new Response("Unauthorized", { status: 401 });
  const p = new URL(req.url).searchParams;
  const rows = listLedger({ from: p.get("from") || undefined, to: p.get("to") || undefined, customerId: Number(p.get("customerId")) || undefined });
  return csvResponse(
    `流水-${new Date().toISOString().slice(0, 10)}.csv`,
    ["时间(UTC)", "客户", "类型", "单号", "运单号", "说明", "操作人", "金额"],
    rows.map((l) => [l.createdAt, l.customerName, LEDGER_TYPE_LABEL[l.type], l.customNo, l.trackingNo, l.note, l.createdBy, l.amount.toFixed(2)]),
  );
}
