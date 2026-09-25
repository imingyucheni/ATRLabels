import { customerAdjustmentSheet } from "@/lib/adjustmentExport";
import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";

/** 按客户导出某批次的补差明细。后台可以导出任意客户；客户只能导出自己的。 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const batchId = Number((await ctx.params).id);
  let customerId = Number(new URL(req.url).searchParams.get("customerId"));
  if (!(await isLoggedIn())) {
    const own = await currentCustomerId();
    if (!own) return new Response("Unauthorized", { status: 401 });
    customerId = own;
  }
  const sheet = customerAdjustmentSheet(batchId, customerId);
  if (!sheet) return new Response("Not found", { status: 404 });
  return csvResponse(sheet.filename, sheet.header, sheet.rows);
}
