import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { customerChannels, getSettings } from "@/lib/db";
import { listSenders } from "@/lib/senders";
import { money, usd } from "@/lib/pricing";
import ShipForm from "@/components/ShipForm";
import { redirect } from "next/navigation";
import { copySource, recentPackages, skuPresets } from "@/lib/portal";
import { isInternational } from "@/lib/shipbest/dhl";
import { getT } from "@/lib/prefs";

export default async function PortalShipPage({ searchParams }: { searchParams: Promise<{ copy?: string }> }) {
  const me = await requireCustomer();
  // 再来一单：复制自己的一张旧订单（国际件去国际下单页）
  const src = copySource(me.id, (await searchParams).copy);
  if (src && isInternational(src.request)) redirect(`/portal/intl?copy=${src.id}`);
  const s = getSettings();
  const t = await getT();
  return (
    <>
      <h1>{t("下单")}</h1>
      <p className="muted">
        {t("填写收件人和包裹信息，点“查询运费”，选择渠道即可出单，运费从账户余额扣除（当前余额 {balance}）。", { balance: usd(me.balance) })}{" "}
        {t("多个订单可以用")} <Link href="/portal/batch">{t("批量下单")}</Link>{t("。")}
      </p>
      {me.balance + me.creditLimit <= 0 && (
        <div className="alert warn row" style={{ justifyContent: "space-between" }}>
          <span>{t("账户余额 {balance}，需要先充值才能出单（可以先查询运费）。", { balance: usd(me.balance) })}</span>
          <Link className="btn primary small" href="/portal/topup">{t("去充值")}</Link>
        </div>
      )}
      {!customerChannels(me.id).length && (
        <div className="alert warn">{t("您的账户还没有开通物流渠道，暂时无法查询运费和下单。请联系客服开通")}{s.supportContact ? `${t("：")}${s.supportContact}` : t("。")}</div>
      )}
      {src && <div className="alert info">{t("已复制订单 {no} 的收件人、包裹和商品，修改后查询运费下单。", { no: src.ref })}</div>}
      <ShipForm key={src?.id ?? "new"} mode="portal" copy={src ?? undefined} recentPackages={recentPackages(me.id)} skuPresets={skuPresets(me.id)} senders={listSenders(me.id)} defaultSender={s.sender} wallet={{ balance: me.balance, creditLimit: me.creditLimit, rule: s.balanceRule }} defaultUnit={s.defaultUnit} defaultCurrency={s.defaultCurrency} />
    </>
  );
}
