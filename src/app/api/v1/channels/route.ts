import { handle } from "@/lib/api/http";
import { channels } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/channels：账户能用的渠道（领星等 ERP “同步物流方式”用） */
export const GET = (req: Request) => handle(req, async (key) => channels(key));
