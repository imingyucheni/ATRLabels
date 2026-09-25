import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { customerChannels, getSettings } from "@/lib/db";
import { money } from "@/lib/pricing";
import ShipForm from "@/components/ShipForm";

export default async function PortalShipPage() {
  const me = await requireCustomer();
  const s = getSettings();
  return (
    <>
      <h1>下单</h1>
      <p className="muted">
        填写收件人和包裹信息，点“查询运费”，选择渠道即可出单，运费从账户余额扣除（当前余额 {money(me.balance)}）。
        多个订单可以用 <Link href="/portal/batch">批量下单</Link>。
      </p>
      {!customerChannels(me.id).length && (
        <div className="alert warn">您的账户还没有开通物流渠道，暂时无法查询运费和下单。请联系客服开通{s.supportContact ? `：${s.supportContact}` : "。"}</div>
      )}
      <ShipForm mode="portal" defaultSender={me.sender ?? s.sender} defaultUnit={s.defaultUnit} defaultCurrency={s.defaultCurrency} />
    </>
  );
}
