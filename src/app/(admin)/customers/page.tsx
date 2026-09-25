import Link from "next/link";
import { getSettings, listCustomers } from "@/lib/db";

const show = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? <span className="muted">默认</span> : `${v}${suffix}`);

export default async function CustomersPage() {
  const customers = listCustomers();
  const { markup } = getSettings();
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>客户</h1>
        <Link className="btn primary" href="/customers/new">＋ 新增客户</Link>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>名称</th><th>联系人</th><th>电话</th><th>邮箱</th><th>加价 %</th><th>固定加价</th><th>最低利润</th><th></th></tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td><td>{c.contact}</td><td>{c.phone}</td><td>{c.email}</td>
                <td>{show(c.markup.percent, "%")}</td><td>{show(c.markup.fixed)}</td><td>{show(c.markup.minProfit)}</td>
                <td>
                  <Link href={`/customers/${c.id}`}>编辑</Link> · <Link href={`/shipments?customerId=${c.id}`}>面单</Link>
                </td>
              </tr>
            ))}
            {!customers.length && <tr><td colSpan={8} className="muted">还没有客户，先新增一个</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        “默认”表示沿用渠道或全局设置（当前全局：+{markup.percent}%，固定 {markup.fixed}，最低利润 {markup.minProfit}）。
      </p>
    </>
  );
}
