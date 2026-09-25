import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { customerChannels, getSettings } from "@/lib/db";
import { listSenders } from "@/lib/senders";
import { money, usd } from "@/lib/pricing";
import ShipForm from "@/components/ShipForm";
import { getT } from "@/lib/prefs";

export default async function PortalShipPage() {
  const me = await requireCustomer();
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
      <ShipForm mode="portal" senders={listSenders(me.id)} defaultSender={s.sender} defaultUnit={s.defaultUnit} defaultCurrency={s.defaultCurrency} />
    </>
  );
}
