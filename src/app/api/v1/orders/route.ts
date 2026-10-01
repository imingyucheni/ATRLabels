import { handle, readJson } from "@/lib/api/http";
import { ApiError, createOrder, getOrder, type CreateBody } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** POST /api/v1/orders：出单（同一个 referenceNo 重复提交返回已有的单） */
export const POST = (req: Request) => handle(req, async (key, { base }) => createOrder(key, await readJson<CreateBody>(req), base));

/** GET /api/v1/orders?referenceNo=…：按客户单号查单 */
export const GET = (req: Request) =>
  handle(req, async (key, { base }) => {
    const ref = new URL(req.url).searchParams.get("referenceNo")?.trim();
    if (!ref) throw new ApiError(400, "VALIDATION_ERROR", "请带上 referenceNo 参数，或用 /api/v1/orders/{orderNo}");
    return getOrder(key, ref, base);
  });
