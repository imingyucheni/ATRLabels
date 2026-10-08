import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { buildTemplate, senderFor } from "@/lib/batch";
import { customerChannels, getSettings, listChannels } from "@/lib/db";
import { getLang, getT } from "@/lib/prefs";
import { localizeChannelName, publicChannel } from "@/lib/carriers";
import { isMultiBoxName } from "@/lib/multiBox";
import { isDhlCode } from "@/lib/shipbest/dhl";

export async function GET() {
  const admin = await isLoggedIn();
  const own = admin ? null : await currentCustomerId();
  if (!admin && !own) return new Response("Unauthorized", { status: 401 });
  // 客户下载的模板预填他自己的寄件地址
  // 物流产品下拉框：客户已开通的渠道
  // 客户看到的是干净的渠道名（不带仓库邮编），导入时也认这个名称
  // 英文界面下载的模板里，渠道名的中文说明（预上网等）换成英文；导入时中英文名称都认
  const lang = await getLang();
  // 批量导入只发美国本土：不放多箱渠道和国际快递（DHL）
  const usable = (c: { code: string; name: string }) => !isMultiBoxName(c.name) && !isDhlCode(c.code);
  const channels = own ? customerChannels(own).filter(usable).map((c) => localizeChannelName(publicChannel(c).name, lang)) : listChannels(true).filter(usable).map((c) => c.name);
  const buf = await buildTemplate(own ? senderFor(own) : getSettings().sender, { channels });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="template.xlsx"; filename*=UTF-8''${encodeURIComponent((await getT())("导单模板.xlsx"))}`,
    },
  });
}
