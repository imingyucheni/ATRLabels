import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomer } from "@/lib/db";
import { listOrderCharges } from "@/lib/ledger";
import { money } from "@/lib/pricing";
import OrderCharges from "@/components/OrderCharges";

export default async function CustomerCharges({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string; q?: string }> }) {
  const c = getCustomer(Number((await params).id));
  if (!c) notFound();
  const sp = await searchParams;
  const rows = listOrderCharges(c.id, { from: sp.from || undefined, to: sp.to || undefined, q: sp.q || undefined });
  const qs = new URLSearchParams({ customerId: String(c.id), ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}) });
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>扣款明细：{c.name}</h1>
        <span><Link href={`/customers/${c.id}`}>← 客户管理</Link> · 余额 <b>{money(c.balance)}</b></span>
      </div>
      <form className="card row" method="get">
        <label className="f">开始日期<input type="date" name="from" defaultValue={sp.from} /></label>
        <label className="f">结束日期<input type="date" name="to" defaultValue={sp.to} /></label>
        <label className="f" style={{ flex: 1, minWidth: 180 }}>搜索<input name="q" placeholder="订单号 / 运单号" defaultValue={sp.q} /></label>
        <button className="primary">筛选</button>
      </form>
      <OrderCharges rows={rows} linkBase="/shipments" exportHref={`/api/charges?${qs}`} />
    </>
  );
}
