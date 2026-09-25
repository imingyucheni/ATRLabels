import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { buildTemplate, senderFor } from "@/lib/batch";
import { getSettings } from "@/lib/db";

export async function GET() {
  const admin = await isLoggedIn();
  const own = admin ? null : await currentCustomerId();
  if (!admin && !own) return new Response("Unauthorized", { status: 401 });
  // 客户下载的模板预填他自己的寄件地址
  const buf = await buildTemplate(own ? senderFor(own) : getSettings().sender);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("导单模板.xlsx")}`,
    },
  });
}
