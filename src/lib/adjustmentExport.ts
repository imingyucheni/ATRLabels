import { getAdjustmentBatch, getBatchHeader, getCustomer, listAdjustments } from "./db";
import { customerSafeColumns, guessColumns, weightDiff } from "./sheetGuess";

/**
 * 某批次里某个客户的补差明细（发给客户 / 客户自己下载）。
 * 只含该客户的单，原始列走白名单，不含任何成本、费用和服务商账户名。
 */
export function customerAdjustmentSheet(batchId: number, customerId: number) {
  const batch = getAdjustmentBatch(batchId);
  const customer = getCustomer(customerId);
  if (!batch || !customer) return null;

  const header = getBatchHeader(batchId);
  const g = guessColumns(header);
  const safe = customerSafeColumns(header, [g.keyCol, g.altKeyCol, g.amountCol]);
  const rows = listAdjustments({ batchId, customerId }).filter((a) => a.shipmentId);
  const total = rows.reduce((s, a) => s + a.customerAmount, 0);
  // 结算重量 - 预报重量，单独一列方便客户查看
  const sampleDiff = rows.map((a) => weightDiff(header, a.raw ?? [])).find(Boolean);
  const diffHeader = sampleDiff ? [`重量差(${sampleDiff.unit})`] : [];
  const diffCell = (raw: string[] | null) => (sampleDiff ? [weightDiff(header, raw ?? [])?.diff ?? ""] : []);

  return {
    filename: `补差明细-${customer.name}-${batch.note || batch.createdAt.slice(0, 10)}.csv`,
    header: ["我方单号", "运单号", ...safe.map((i) => header[i]), ...diffHeader, "说明", "补收(+)/退还(-)"],
    rows: [
      ...rows.map((a) => [a.customNo, a.trackingNo ?? a.matchKey, ...safe.map((i) => a.raw?.[i] ?? ""), ...diffCell(a.raw), a.reason, a.customerAmount.toFixed(2)]),
      [],
      ["合计", `${rows.length} 单`, ...safe.map(() => ""), ...diffHeader.map(() => ""), "", total.toFixed(2)],
    ] as unknown[][],
  };
}
