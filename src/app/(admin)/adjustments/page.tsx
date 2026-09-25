import Link from "next/link";
import { ADJUSTMENT_POLICY_LABEL, getSettings, listAdjustmentBatches } from "@/lib/db";
import { money } from "@/lib/pricing";
import ImportAdjustments from "./ImportAdjustments";

export default async function AdjustmentsPage() {
  const batches = listAdjustmentBatches();
  const { adjustmentPolicy } = getSettings();
  return (
    <>
      <h1>官方账单补差</h1>
      <p className="muted">
        ShipBest 系统扣的是预报价格，官方账单出来后，重量或分区有差异会多退少补。收到他们的补差表格后在这里上传，
        系统按运单号（或 ShipBest 单号 / 自定义单号）自动对应到面单和客户。当前转嫁规则：<b>{ADJUSTMENT_POLICY_LABEL[adjustmentPolicy]}</b>
        （<Link href="/settings">修改</Link>）。
      </p>
      <ImportAdjustments />

      <div className="card table-wrap">
        <h2>导入记录</h2>
        <table>
          <thead>
            <tr><th>导入时间</th><th>文件</th><th className="num">行数</th><th className="num">已匹配</th><th className="num">ShipBest 补差</th><th className="num">向客户补收/退</th><th>规则</th><th></th></tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id}>
                <td className="small muted">{b.createdAt}</td>
                <td>{b.filename}{b.note && <div className="small muted">{b.note}</div>}</td>
                <td className="num">{b.rowCount}</td>
                <td className="num">{b.matchedCount === b.rowCount ? b.matchedCount : <span className="profit-neg">{b.matchedCount}</span>}</td>
                <td className="num">{money(b.costTotal)}</td>
                <td className="num">{money(b.customerTotal)}</td>
                <td className="small">{ADJUSTMENT_POLICY_LABEL[b.policy]}</td>
                <td><Link href={`/adjustments/${b.id}`}>查看</Link></td>
              </tr>
            ))}
            {!batches.length && <tr><td colSpan={8} className="muted">还没有导入过</td></tr>}
          </tbody>
        </table>
        <p className="small muted">金额：正数 = ShipBest 向我们补扣 / 向客户补收；负数 = 退款。</p>
      </div>
    </>
  );
}
