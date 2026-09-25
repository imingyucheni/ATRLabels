import { fmtTime } from "@/lib/time";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSettings, getShipment, listAdjustments, shipmentProfit } from "@/lib/db";
import { money } from "@/lib/pricing";
import { defaultCancelFees } from "@/lib/service";
import { SB_STATUS, type Address } from "@/lib/shipbest/types";
import FlashForm from "@/components/FlashForm";
import StatusBadge from "@/components/StatusBadge";
import Profit from "@/components/Profit";
import { cancelAction, confirmCancelAction, refreshAction, saveLabelNoteAction, withdrawCancelAction } from "@/app/actions";
import { stampFor, stampText } from "@/lib/stamp";
import { LEDGER_TYPE_LABEL, listLedger } from "@/lib/ledger";

const UNITS = { 1: ["g", "cm"], 2: ["kg", "cm"], 3: ["lb", "in"] } as const;
const SIGN = ["不需要签名", "直接签名", "间接签名", "成人签名"];

function Addr({ a }: { a: Address }) {
  return (
    <div>
      <div><b>{a.nameFirst} {a.nameLast}</b>{a.corporateName ? ` · ${a.corporateName}` : ""}</div>
      <div>{a.address1}{a.address2 ? `, ${a.address2}` : ""}</div>
      <div>{a.city}{a.province ? `, ${a.province}` : ""} {a.zipCode} {a.country}</div>
      <div className="muted small">{[a.phone, a.email].filter(Boolean).join(" · ")}</div>
    </div>
  );
}

const NATURE_LABEL: Record<string, string> = { "1": "带磁", "2": "不带磁", "3": "带电", "4": "不带电", "5": "液体" };
const natureLabel = (v?: string | null) => (v ?? "").split(",").filter(Boolean).map((c) => NATURE_LABEL[c.trim()] ?? c).join("、");

export default async function ShipmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const s = getShipment(Number((await params).id));
  if (!s) notFound();
  const [wu, lu] = UNITS[s.pkg.displayUnitSystem];
  const fees = defaultCancelFees(s);
  const adjustments = listAdjustments({ shipmentId: s.id });
  const stampCfg = stampFor(s);
  const charges = listLedger({ shipmentId: s.id }).reverse();
  const canCancel = s.status === "pending" || s.status === "labeled" || s.status === "exception";

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>面单 {s.customNo} <StatusBadge status={s.status} /></h1>
        <Link href="/shipments">← 返回列表</Link>
      </div>

      {s.errorMsg && <div className={`alert ${s.status === "exception" ? "err" : "warn"}`}>{s.errorMsg}</div>}

      <div className="grid2">
        <div className="card">
          <h2>面单</h2>
          {s.labelPath && s.status === "cancelled" ? (
            <>
              <div className="alert err">这张面单已取消作废，不能再打印使用。下面是印了 VOID 的留档。</div>
              <iframe src={`/api/labels/${s.id}`} style={{ width: "100%", height: 480, border: "1px solid var(--line)", borderRadius: 8 }} />
            </>
          ) : s.labelPath ? (
            <>
              {s.status === "cancel_requested" && <div className="alert warn">已申请取消：在 ShipBest 确认取消前请不要使用这张面单。</div>}
              <div className="row" style={{ marginBottom: 12 }}>
                <a className="btn primary" href={`/api/labels/${s.id}`} target="_blank">打开 / 打印 4×6 面单</a>
                <a className="btn" href={`/api/labels/${s.id}?download=1`}>下载</a>
                {stampCfg && <a className="btn" href={`/api/labels/${s.id}?raw=1`} target="_blank">原始面单（不加印）</a>}
              </div>
              {s.labelMime === "application/pdf" ? (
                <iframe src={`/api/labels/${s.id}`} style={{ width: "100%", height: 480, border: "1px solid var(--line)", borderRadius: 8 }} />
              ) : s.labelMime?.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/labels/${s.id}`} alt="label" style={{ maxWidth: "100%", border: "1px solid var(--line)" }} />
              ) : null}
            </>
          ) : (
            <p className="muted">面单尚未生成。ShipBest 一般几秒内出单，可点“刷新状态”。</p>
          )}
          <FlashForm action={saveLabelNoteAction} submitLabel="保存" submitClass="small" className="row">
            <input type="hidden" name="id" value={s.id} />
            <label className="f" style={{ flex: 1, minWidth: 220 }}>
              面单加印文字{stampCfg ? "" : "（这个客户当前不加印）"}
              <input name="labelNote" maxLength={200} defaultValue={s.labelNote ?? ""} placeholder={stampText({ ...s, labelNote: null }, stampCfg ?? getSettings().stamp) || "留空则印 SKU"} />
            </label>
          </FlashForm>
          <div className="row" style={{ marginTop: 12 }}>
            <FlashForm action={refreshAction} submitLabel="刷新状态" submitClass="" inline>
              <input type="hidden" name="id" value={s.id} />
            </FlashForm>
            {canCancel && (
              <FlashForm action={cancelAction} submitLabel="申请取消" submitClass="danger" inline
                confirm="确认取消这张面单？已出面单的订单需 ShipBest 人工取消，并收取取消费。">
                <input type="hidden" name="id" value={s.id} />
              </FlashForm>
            )}
          </div>
          {s.status === "cancel_requested" && (
            <div className="card" style={{ marginTop: 12, background: "var(--warn-soft)" }}>
              <h2>确认已取消</h2>
              <p className="small">在 OMS 联系 ShipBest 完成取消后，填写费用并确认。退款 = 客户价 - 客户取消手续费。</p>
              <FlashForm action={confirmCancelAction} submitLabel="确认已取消">
                <input type="hidden" name="id" value={s.id} />
                <div className="row" style={{ marginBottom: 8 }}>
                  <label className="f">向客户收取的取消手续费<input name="cancelFee" type="number" step="0.01" defaultValue={fees.cancelFee} /></label>
                  <label className="f">ShipBest 收取的取消费<input name="sbCancelFee" type="number" step="0.01" defaultValue={fees.sbCancelFee} /></label>
                </div>
              </FlashForm>
              <p className="small muted" style={{ marginTop: 12 }}>ShipBest 拒绝取消、或者申请错了：</p>
              <FlashForm action={withdrawCancelAction} submitLabel="撤回取消申请" submitClass="" confirm="撤回后面单恢复为“已出面单”，客户可以继续使用。确定？">
                <input type="hidden" name="id" value={s.id} />
              </FlashForm>
            </div>
          )}
        </div>

        <div className="card">
          <h2>费用</h2>
          <dl className="kv">
            <dt>客户</dt><dd>{s.customerName}</dd>
            <dt>渠道</dt><dd>{s.channelName} <span className="muted small">({s.channelCode})</span></dd>
            <dt>分区</dt><dd>{s.zone ?? "-"}</dd>
            <dt>试算成本</dt><dd>{money(s.quotedCost, s.currency)}</dd>
            <dt>实扣成本</dt><dd>{money(s.actualCost, s.currency)}{s.actualCost !== null && Math.abs(s.actualCost - s.quotedCost) > 0.005 && <span className="profit-neg small">（与试算不同）</span>}</dd>
            <dt>加价规则</dt><dd>+{s.rule.percent}% + {money(s.rule.fixed)}，最低利润 {money(s.rule.minProfit)}</dd>
            <dt>客户价</dt><dd><b>{money(s.price, s.currency)}</b></dd>
            {s.status === "cancelled" && (
              <>
                <dt>客户取消费</dt><dd>{money(s.cancelFee, s.currency)}</dd>
                <dt>ShipBest取消费</dt><dd>{money(s.sbCancelFee, s.currency)}</dd>
                <dt>应退客户</dt><dd><b>{money(s.refundAmount, s.currency)}</b></dd>
              </>
            )}
            {adjustments.length > 0 && (
              <>
                <dt>账单补差</dt><dd>ShipBest {money(s.costAdj, s.currency)} · 向客户 {money(s.customerAdj, s.currency)}</dd>
              </>
            )}
            <dt>利润</dt><dd><Profit value={shipmentProfit(s)} currency={s.currency} /></dd>
          </dl>
          <h3>订单</h3>
          <dl className="kv">
            <dt>自定义单号</dt><dd>{s.customNo}</dd>
            <dt>ShipBest 单号</dt><dd>{s.orderNo ?? "-"}</dd>
            <dt>运单号</dt><dd>{s.trackingNo ?? "-"}</dd>
            <dt>ShipBest 状态</dt><dd>{s.sbStatus ? SB_STATUS[s.sbStatus] ?? s.sbStatus : "-"}</dd>
            <dt>创建时间</dt><dd>{fmtTime(s.createdAt)}</dd>
            {s.remark && (<><dt>备注</dt><dd>{s.remark}</dd></>)}
          </dl>
        </div>
      </div>

      {adjustments.length > 0 && (
        <div className="card">
          <h2>官方账单补差</h2>
          <table>
            <thead><tr><th>导入时间</th><th>批次</th><th className="num">ShipBest 补差</th><th className="num">向客户</th><th>原因</th></tr></thead>
            <tbody>
              {adjustments.map((a) => (
                <tr key={a.id}>
                  <td className="small muted">{fmtTime(a.createdAt)}</td>
                  <td><Link href={`/adjustments/${a.batchId}`}>{a.batchFilename}</Link></td>
                  <td className="num">{money(a.costAmount)}</td>
                  <td className="num">{money(a.customerAmount)}</td>
                  <td className="small">{a.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {charges.length > 0 && (
        <div className="card">
          <h2>这一单的扣款记录</h2>
          <table>
            <thead><tr><th>时间</th><th>类型</th><th>说明</th><th className="num">金额</th></tr></thead>
            <tbody>
              {charges.map((l) => (
                <tr key={l.id}>
                  <td className="small muted">{fmtTime(l.createdAt)}</td>
                  <td>{LEDGER_TYPE_LABEL[l.type]}</td>
                  <td className="small">{l.note}</td>
                  <td className={`num ${l.amount >= 0 ? "profit-pos" : ""}`}>{l.amount >= 0 ? "+" : ""}{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}><b>合计扣款</b></td><td className="num"><b>{money(-charges.reduce((a, l) => a + l.amount, 0))}</b></td></tr></tfoot>
          </table>
        </div>
      )}

      <div className="grid2">
        <div className="card"><h2>寄件人</h2><Addr a={s.sender} /></div>
        <div className="card"><h2>收件人</h2><Addr a={s.recipient} /></div>
      </div>

      <div className="card">
        <h2>包裹</h2>
        <p>
          {s.pkg.length} × {s.pkg.width} × {s.pkg.height} {lu}，{s.pkg.weight} {wu} · {SIGN[s.pkg.signServiceType]}
          {s.pkg.insuranceService ? ` · 保险 ${money(s.pkg.insuranceFee ?? 0, s.pkg.currency)}` : ""}
        </p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>SKU</th><th>品名</th><th>海关编码</th><th>性质</th><th className="num">数量</th><th className="num">申报单价</th></tr></thead>
            <tbody>
              {s.skuList.map((k, i) => (
                <tr key={i}>
                  <td>{k.sku}</td><td>{k.productNameCn} / {k.productNameEn}</td><td>{k.hsCode}</td><td>{natureLabel(k.productNature)}</td>
                  <td className="num">{k.quantity}</td><td className="num">{money(k.declaredUnitPrice, k.declaredCurrency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
