import { isLoggedIn } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { getAdjustmentBatch, getBatchHeader, getCustomer, listAdjustments } from "@/lib/db";
import { customerSafeColumns, guessColumns } from "@/lib/sheetGuess";

/** 按客户导出某批次的补差明细，用于发给客户。不含任何成本、费用列。 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return new Response("Unauthorized", { status: 401 });
  const batchId = Number((await ctx.params).id);
  const customerId = Number(new URL(req.url).searchParams.get("customerId"));
  const batch = getAdjustmentBatch(batchId);
  const customer = getCustomer(customerId);
  if (!batch || !customer) return new Response("Not found", { status: 404 });

  const header = getBatchHeader(batchId);
  const g = guessColumns(header);
  const safe = customerSafeColumns(header, [g.keyCol, g.altKeyCol, g.amountCol]);
  const rows = listAdjustments({ batchId, customerId }).filter((a) => a.shipmentId);
  const total = rows.reduce((s, a) => s + a.customerAmount, 0);

  return csvResponse(
    `补差明细-${customer.name}-${batch.note || batch.createdAt.slice(0, 10)}.csv`,
    ["我方单号", "运单号", ...safe.map((i) => header[i]), "说明", "补收(+)/退还(-)"],
    [
      ...rows.map((a) => [a.customNo, a.trackingNo ?? a.matchKey, ...safe.map((i) => a.raw?.[i] ?? ""), a.reason, a.customerAmount.toFixed(2)]),
      [],
      ["合计", `${rows.length} 单`, ...safe.map(() => ""), "", total.toFixed(2)],
    ],
  );
}
