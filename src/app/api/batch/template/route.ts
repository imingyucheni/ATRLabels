import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { buildTemplate } from "@/lib/batch";

export async function GET() {
  if (!(await isLoggedIn()) && !(await currentCustomerId())) return new Response("Unauthorized", { status: 401 });
  const buf = await buildTemplate();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("批量下单模板.xlsx")}`,
    },
  });
}
