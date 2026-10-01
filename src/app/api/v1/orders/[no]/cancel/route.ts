import { handle } from "@/lib/api/http";
import { cancelOrder } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** POST /api/v1/orders/{no}/cancel：取消订单 */
export const POST = (req: Request, ctx: { params: Promise<{ no: string }> }) =>
  handle(req, async (key, { base }) => cancelOrder(key, decodeURIComponent((await ctx.params).no), base));
