import Link from "next/link";
import { customerChannels, getSettings, listChannels, listCustomers } from "@/lib/db";
import ShipForm from "@/components/ShipForm";
import { getT } from "@/lib/prefs";

/** 运费试算（销售用，不出单）：给新客户报价、比较渠道、测试加价幅度 */
export default async function QuotePage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const { customerId } = await searchParams;
  const customers = listCustomers();
  const s = getSettings();
  const hasChannels = listChannels(true).length > 0;
  const t = await getT();
  return (
    <>
      <h1>{t("运费试算")}</h1>
      <p className="muted">
        {t("只试算、不出单。可以按新客户临时设的加价试算所有渠道，也可以选已有客户看他实际的价格。")}
        {t("出单在客户自己的 OMS 里进行（需要代客户出单时，在“客户管理”点“进入 OMS”）。")}
      </p>
      {!hasChannels && <div className="alert warn">{t("没有启用的渠道，请先到")} <Link href="/settings">{t("设置")}</Link> {t("同步渠道。")}</div>}
      <ShipForm
        customers={customers.map((c) => ({ id: c.id, name: c.name, sender: c.sender, channelCount: customerChannels(c.id).length }))}
        defaultCustomerId={Number(customerId) || undefined}
        defaultSender={s.sender}
        defaultUnit={s.defaultUnit}
        defaultCurrency={s.defaultCurrency}
      />
    </>
  );
}
