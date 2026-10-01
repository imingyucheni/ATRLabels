import { handle, readJson } from "@/lib/api/http";
import { rates, type ApiShipmentBody } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** POST /api/v1/rates：运费试算（所有渠道或指定 channel） */
export const POST = (req: Request) => handle(req, async (key) => rates(key, await readJson<ApiShipmentBody & { channel?: string }>(req)));
