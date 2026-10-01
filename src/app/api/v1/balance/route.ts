import { handle } from "@/lib/api/http";
import { balance } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/balance：账户余额 */
export const GET = (req: Request) => handle(req, async (key) => balance(key));
