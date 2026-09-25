import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { buildTemplate, senderFor } from "@/lib/batch";
import { customerChannels, getSettings, listChannels } from "@/lib/db";
import { getT } from "@/lib/prefs";
import { publicChannel } from "@/lib/carriers";

export async function GET() {
  const admin = await isLoggedIn();
  const own = admin ? null : await currentCustomerId();
  if (!admin && !own) return new Response("Unauthorized", { status: 401 });
  // 客户下载的模板预填他自己的寄件地址
  // 物流产品下拉框：客户已开通的渠道
  // 客户看到的是干净的渠道名（不带仓库邮编），导入时也认这个名称
  const channels = own ? customerChannels(own).map((c) => publicChannel(c).name) : listChannels(true).map((c) => c.name);
  const buf = await buildTemplate(own ? senderFor(own) : getSettings().sender, { channels });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent((await getT())("导单模板.xlsx"))}`,
    },
  });
}
