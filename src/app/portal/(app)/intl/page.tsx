import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { listSenders } from "@/lib/senders";
import { usd } from "@/lib/pricing";
import { copySource, portalChannelCodes, recentPackages, skuPresets } from "@/lib/portal";
import { dhlSettings, isDhlCode } from "@/lib/shipbest/dhl";
import ShipForm from "@/components/ShipForm";
import { getT } from "@/lib/prefs";

export const dynamic = "force-dynamic";

/** 国际下单（DHL Express）：和美国本地下单一样的流程，多了报关信息 */
export default async function PortalIntlPage({ searchParams }: { searchParams: Promise<{ copy?: string }> }) {
  const me = await requireCustomer();
  const src = copySource(me.id, (await searchParams).copy);
  const s = getSettings();
  const t = await getT();
  const open = portalChannelCodes(me.id).some(isDhlCode);
  return (
    <>
      <h1>{t("国际下单")}</h1>
      <p className="muted">
        {t("寄往美国以外的国家 / 地区，走 DHL Express 国际快递。填写收件人、包裹和报关信息，点“查询运费”，选择服务即可出单，运费从账户余额扣除（当前余额 {balance}）。", { balance: usd(me.balance) })}{" "}
        {t("寄美国境内请用")} <Link href="/portal/ship">{t("美国本地下单")}</Link>{t("。")}
      </p>
      {!open && <div className="alert warn">{t("您的账户还没有开通国际快递（DHL），请联系客服开通")}{s.supportContact ? `${t("：")}${s.supportContact}` : t("。")}</div>}
      {me.balance + me.creditLimit <= 0 && (
        <div className="alert warn row" style={{ justifyContent: "space-between" }}>
          <span>{t("账户余额 {balance}，需要先充值才能出单（可以先查询运费）。", { balance: usd(me.balance) })}</span>
          <Link className="btn primary small" href="/portal/topup">{t("去充值")}</Link>
        </div>
      )}
      {src && <div className="alert info">{t("已复制订单 {no} 的收件人、包裹和商品，修改后查询运费下单。", { no: src.ref })}</div>}
      <ShipForm key={src?.id ?? "new"} mode="portal" intl copy={src ?? undefined} recentPackages={recentPackages(me.id)} skuPresets={skuPresets(me.id)} defaultOrigin={dhlSettings().originCountry} senders={listSenders(me.id)} defaultSender={s.sender} defaultUnit={s.defaultUnit} defaultCurrency="USD" />
    </>
  );
}
