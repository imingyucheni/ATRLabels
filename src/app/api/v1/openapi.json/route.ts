import { getSettings } from "@/lib/db";
import { openapiSpec } from "@/lib/api/openapi";
import { publicBase } from "@/lib/stores/web";

export const dynamic = "force-dynamic";

/** GET /api/v1/openapi.json：接口描述（公开，不用密钥） */
export const GET = (req: Request) =>
  new Response(JSON.stringify(openapiSpec(publicBase(req), getSettings().brandName), null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" },
  });
