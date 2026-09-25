import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { getSettings } from "@/lib/db";
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
      <ShipForm mode="portal" defaultSender={me.sender ?? s.sender} defaultUnit={s.defaultUnit} defaultCurrency={s.defaultCurrency} />
    </>
  );
}
