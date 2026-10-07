import MultiBoxForm from "@/components/MultiBoxForm";
import { customerChannels, getSettings, houseCustomerId, listCustomers } from "@/lib/db";
import { isMultiBoxName } from "@/lib/multiBox";
import { getT } from "@/lib/prefs";
import { requireAdmin } from "@/lib/auth";
import { multiEnabled } from "@/lib/multiAccess";

export const dynamic = "force-dynamic";

/** 多箱寄出（后台）：给客户（或公司自用账户）下一票多箱货：UPS HWT / FedEx MWT */
export default async function AdminMultiPage() {
  const who = await requireAdmin();
  const t = await getT();
  const houseId = houseCustomerId();
  const list = listCustomers({ includeInternal: true });
  // 公司自用账户排第一（按成本价），开通了多箱渠道的客户排前面
  const customers = list
    .map((c) => ({ id: c.id, name: c.id === houseId || multiEnabled(c.id) ? c.name : `${c.name} ${t("（OMS 未开放多箱）")}`, sender: c.sender ?? null, channels: customerChannels(c.id).filter((ch) => isMultiBoxName(ch.name)).map((ch) => ch.name) }))
    .sort((a, b) => Number(b.id === houseId) - Number(a.id === houseId) || Number(b.channels.length > 0) - Number(a.channels.length > 0));
  return (
    <>
      <h1 style={{ marginBottom: 2 }}>{t("多箱寄出")}</h1>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t("同一个寄件地址、同一个收件地址的多箱货，一票下单按总重量计价（UPS HWT / FedEx MWT），比一箱一箱单独寄便宜。按箱规填尺寸、单箱重量和箱数。")}
      </p>
      <MultiBoxForm mode="admin" customers={customers} defaultSender={getSettings().sender} showCost={who.role === "owner"} />
    </>
  );
}
