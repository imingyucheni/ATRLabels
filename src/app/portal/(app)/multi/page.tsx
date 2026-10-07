import MultiBoxForm from "@/components/MultiBoxForm";
import { requireCustomer } from "@/lib/auth";
import { customerChannels, getSettings } from "@/lib/db";
import { isMultiBoxName } from "@/lib/multiBox";
import { listSenders } from "@/lib/senders";
import { usd } from "@/lib/pricing";
import { getT } from "@/lib/prefs";
import { multiEnabled } from "@/lib/multiAccess";
import { redirect } from "next/navigation";

/** 多箱寄出（客户 OMS）：一票多箱寄同一个地址，按总重量计价 */
export default async function PortalMultiPage() {
  const me = await requireCustomer();
  // 后台没开放给这个客户：不显示
  if (!multiEnabled(me.id)) redirect("/portal");
  const t = await getT();
  const channels = customerChannels(me.id).filter((c) => isMultiBoxName(c.name)).map((c) => c.name);
  return (
    <>
      <h1 style={{ marginBottom: 2 }}>{t("多箱寄出")}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("同一个地址的多箱货（例如补货到仓库、门店），一票下单按总重量计价，比一箱一箱寄便宜。按箱规填尺寸、单箱重量和箱数即可（当前余额 {balance}）。", { balance: usd(me.balance) })}
      </p>
      <MultiBoxForm mode="portal" channels={channels} senders={listSenders(me.id)} defaultSender={getSettings().sender} />
    </>
  );
}
