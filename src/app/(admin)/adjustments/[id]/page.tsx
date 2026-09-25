import { fmtTime } from "@/lib/time";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ADJUSTMENT_POLICY_LABEL, getAdjustmentBatch, listAdjustments } from "@/lib/db";
import { money } from "@/lib/pricing";
import FlashForm from "@/components/FlashForm";
import { deleteBatchAction, linkAdjustmentAction, unlinkAdjustmentAction } from "@/app/actions";

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const b = getAdjustmentBatch(Number((await params).id));
  if (!b) notFound();
  const rows = listAdjustments({ batchId: b.id });
  const unmatched = rows.filter((r) => !r.shipmentId);
  const groups = new Map<number, { id: number; name: string; count: number; cost: number; customer: number }>();
  for (const r of rows) {
    if (!r.customerId) continue;
    const g = groups.get(r.customerId) ?? { id: r.customerId, name: r.customerName ?? "", count: 0, cost: 0, customer: 0 };
    g.count++;
    g.cost += r.costAmount;
    g.customer += r.customerAmount;
    groups.set(r.customerId, g);
  }
  const byCustomer = [...groups.values()].sort((x, y) => y.customer - x.customer);

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>补差批次：{b.filename}</h1>
        <Link href="/adjustments">← 返回</Link>
      </div>
      <div className="stats">
        <div className="stat"><div className="muted">导入时间</div><div>{fmtTime(b.createdAt)}</div></div>
        <div className="stat"><div className="muted">ShipBest 补差合计</div><div className="v">{money(b.costTotal)}</div></div>
        <div className="stat"><div className="muted">向客户补收/退合计</div><div className="v">{money(b.customerTotal)}</div></div>
        <div className="stat"><div className="muted">已匹配 / 总行数</div><div className="v">{b.matchedCount} / {b.rowCount}</div></div>
      </div>
      <p className="small muted">转嫁规则：{ADJUSTMENT_POLICY_LABEL[b.policy]}{b.note ? ` · 备注：${b.note}` : ""}</p>

      {byCustomer.length > 0 && (
        <div className="card">
          <h2>按客户（发给客户的明细）</h2>
          <p className="small muted">导出的明细只包含该客户自己的单，保留日期、尺寸、重量、分区、备注等说明列，金额为向客户补收/退还的金额，不含任何成本和费用列。</p>
          <table>
            <thead><tr><th>客户</th><th className="num">单数</th><th className="num">ShipBest 补差</th><th className="num">向客户补收/退</th><th></th></tr></thead>
            <tbody>
              {byCustomer.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="num">{c.count}</td>
                  <td className="num">{money(c.cost)}</td>
                  <td className="num"><b>{money(c.customer)}</b></td>
                  <td>
                    <a className="btn small" href={`/api/adjustments/${b.id}/export?customerId=${c.id}`}>导出给客户</a>{" "}
                    <Link className="small" href={`/customers/${c.id}/statement`}>对账单</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {unmatched.length > 0 && (
        <div className="card">
          <h2>未匹配（{unmatched.length}）</h2>
          <p className="small muted">可能是单号格式不同，或者不是通过本系统出的单。可以输入本系统里的运单号 / 自定义单号手动关联。未关联的补差只计入我们的成本，不会算到客户头上。</p>
          <table>
            <thead><tr><th>行</th><th>表格中的单号</th><th className="num">ShipBest 补差</th><th>原因</th><th>手动关联</th></tr></thead>
            <tbody>
              {unmatched.map((r) => (
                <tr key={r.id}>
                  <td className="muted">{r.rowNo}</td><td>{r.matchKey}</td><td className="num">{money(r.costAmount)}</td><td className="small">{r.reason}</td>
                  <td>
                    <FlashForm action={linkAdjustmentAction} submitLabel="关联" submitClass="small">
                      <input type="hidden" name="id" value={r.id} />
                      <input name="key" placeholder="运单号 / 自定义单号" required style={{ width: 200, marginRight: 6 }} />
                      <label className="small nowrap" style={{ marginRight: 6 }}><input type="checkbox" name="force" value="1" /> 仍然关联</label>
                    </FlashForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card table-wrap">
        <h2>明细</h2>
        <table>
          <thead><tr><th>行</th><th>单号</th><th>面单</th><th>客户</th><th className="num">ShipBest 补差</th><th className="num">向客户</th><th>原因</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted">{r.rowNo}</td>
                <td>{r.matchKey}</td>
                <td>{r.shipmentId ? <Link href={`/shipments/${r.shipmentId}`}>{r.customNo}</Link> : <span className="profit-neg">未匹配</span>}</td>
                <td>{r.customerName ?? "-"}</td>
                <td className="num">{money(r.costAmount)}</td>
                <td className="num">{r.shipmentId ? money(r.customerAmount) : "-"}</td>
                <td className="small">{r.reason}</td>
                <td>
                  {r.shipmentId && (
                    <FlashForm action={unlinkAdjustmentAction} submitLabel="取消关联" submitClass="small" confirm="取消这一条的关联？客户钱包里这笔补差会一起撤回。">
                      <input type="hidden" name="id" value={r.id} />
                    </FlashForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <FlashForm action={deleteBatchAction} submitLabel="撤销整个批次" submitClass="danger" confirm="确认撤销？这个批次的所有补差记录都会删除，可以之后重新导入。">
        <input type="hidden" name="id" value={b.id} />
      </FlashForm>
    </>
  );
}
