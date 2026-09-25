import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { customerChannels, getSettings } from "@/lib/db";
import { money, usd } from "@/lib/pricing";
import ShipForm from "@/components/ShipForm";

export default async function PortalShipPage() {
  const me = await requireCustomer();
  const s = getSettings();
  return (
    <>
      <h1>下单</h1>
      <p className="muted">
        填写收件人和包裹信息，点“查询运费”，选择渠道即可出单，运费从账户余额扣除（当前余额 {usd(me.balance)}）。
        多个订单可以用 <Link href="/portal/batch">批量下单</Link>。
      </p>
      {!me.sender && (
        <p className="small muted">
          寄件地址默认使用我们的发货仓地址{s.sender?.city ? `（${s.sender.city}, ${s.sender.province ?? ""} ${s.sender.zipCode}）` : ""}；要改成自己的，请到 <Link href="/portal/account">账户设置</Link> 填写默认寄件地址。
        </p>
      )}
      {me.balance + me.creditLimit <= 0 && (
        <div className="alert warn row" style={{ justifyContent: "space-between" }}>
          <span>账户余额 {usd(me.balance)}，需要先充值才能出单（可以先查询运费）。</span>
          <Link className="btn primary small" href="/portal/topup">去充值</Link>
        </div>
      )}
      {!customerChannels(me.id).length && (
        <div className="alert warn">您的账户还没有开通物流渠道，暂时无法查询运费和下单。请联系客服开通{s.supportContact ? `：${s.supportContact}` : "。"}</div>
      )}
      <ShipForm mode="portal" defaultSender={me.sender ?? s.sender} defaultUnit={s.defaultUnit} defaultCurrency={s.defaultCurrency} />
    </>
  );
}
