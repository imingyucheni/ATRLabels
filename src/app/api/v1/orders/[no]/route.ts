import { handle } from "@/lib/api/http";
import { getOrder } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/orders/{orderNo 或 referenceNo}：订单状态、运单号、面单是否已出 */
export const GET = (req: Request, ctx: { params: Promise<{ no: string }> }) =>
  handle(req, async (key, { base }) => getOrder(key, decodeURIComponent((await ctx.params).no), base));
