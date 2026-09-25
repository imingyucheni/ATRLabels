import Link from "next/link";
import { getSettings, listChannels, listCustomers } from "@/lib/db";
import NewShipmentForm from "./NewShipmentForm";

export default async function NewShipmentPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const { customerId } = await searchParams;
  const customers = listCustomers();
  const s = getSettings();
  const hasChannels = listChannels(true).length > 0;
  return (
    <>
      <h1>新建面单</h1>
      {!customers.length && <div className="alert warn">还没有客户，请先 <Link href="/customers/new">新增客户</Link>。</div>}
      {!hasChannels && <div className="alert warn">没有启用的渠道，请先到 <Link href="/settings">设置</Link> 同步渠道。</div>}
      {!s.sender && <div className="alert warn">还没有设置默认寄件地址，可以到 <Link href="/settings">设置</Link> 填写，省去每次输入。</div>}
      <NewShipmentForm
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        defaultCustomerId={Number(customerId) || undefined}
        defaultSender={s.sender}
        defaultUnit={s.defaultUnit}
        defaultCurrency={s.defaultCurrency}
      />
    </>
  );
}
