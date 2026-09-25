import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/auth";
import { getOwnShipment, listOwnAdjustments, portalCancelFeePercent } from "@/lib/portal";
import { money } from "@/lib/pricing";
import type { Address } from "@/lib/shipbest/types";
import FlashForm from "@/components/FlashForm";
import StatusBadge from "@/components/StatusBadge";
import { portalCancelAction, portalRefreshAction, portalSaveLabelNoteAction } from "@/app/portal/actions";

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

export default async function PortalShipmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireCustomer();
  const s = getOwnShipment(me.id, Number((await params).id));
  if (!s) notFound();
  const adjustments = listOwnAdjustments(me.id).filter((a) => a.shipmentId === s.id);
  const [wu, lu] = UNITS[s.pkg.displayUnitSystem] ?? UNITS[3];
  const canCancel = s.status === "pending" || s.status === "labeled" || s.status === "exception";
  const feePct = portalCancelFeePercent();

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{s.customerRef || s.customNo} <StatusBadge status={s.status} /></h1>
        <Link href="/portal/shipments">← 返回列表</Link>
      </div>
      {s.problem && <div className="alert err">订单异常：{s.problem}。可以申请取消，运费会全额退回。</div>}
      {s.status === "cancel_requested" && <div className="alert warn">取消申请处理中，完成后费用会退回账户余额。</div>}

      <div className="grid2">
        <div className="card">
          <h2>面单</h2>
          {s.hasLabel ? (
            <>
              <div className="row" style={{ marginBottom: 12 }}>
                <a className="btn primary" href={`/api/labels/${s.id}`} target="_blank">打开 / 打印 4×6 面单</a>
                <a className="btn" href={`/api/labels/${s.id}?download=1`}>下载</a>
              </div>
              {s.labelMime === "application/pdf" && (
                <iframe src={`/api/labels/${s.id}`} style={{ width: "100%", height: 480, border: "1px solid var(--line)", borderRadius: 8 }} />
              )}
            </>
          ) : s.status === "pending" ? (
            <p className="muted">面单生成中，一般几秒到一分钟。可以点“刷新”。</p>
          ) : (
            <p className="muted">没有面单。</p>
          )}
          {s.stampOn && s.status !== "cancelled" && (
            <FlashForm action={portalSaveLabelNoteAction} submitLabel="保存" submitClass="small" className="row">
              <input type="hidden" name="id" value={s.id} />
              <label className="f" style={{ flex: 1, minWidth: 220 }}>
                面单上加印的文字（留空则印 SKU）
                <input name="labelNote" maxLength={200} defaultValue={s.labelNote ?? ""} placeholder={s.stampText} />
              </label>
            </FlashForm>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            {s.status === "pending" && (
              <FlashForm action={portalRefreshAction} submitLabel="刷新" submitClass="" inline>
                <input type="hidden" name="id" value={s.id} />
              </FlashForm>
            )}
            {canCancel && (
              <FlashForm
                action={portalCancelAction}
                submitLabel="申请取消"
                submitClass="danger"
                inline
                confirm={s.status === "labeled" ? `确认取消？已出面单的订单取消会收取运费 ${feePct}% 的手续费，其余退回账户余额。` : "确认取消这张订单？运费会退回账户余额。"}
              >
                <input type="hidden" name="id" value={s.id} />
              </FlashForm>
            )}
          </div>
        </div>

        <div className="card">
          <h2>费用</h2>
          <dl className="kv">
            <dt>渠道</dt><dd>{s.channelName}</dd>
            <dt>分区</dt><dd>{s.zone ?? "-"}</dd>
            <dt>运单号</dt><dd>{s.trackingNo ?? "-"}</dd>
            <dt>运费</dt><dd><b>{money(s.price, s.currency)}</b></dd>
            {s.status === "cancelled" && (
              <>
                <dt>取消手续费</dt><dd>{money(s.cancelFee, s.currency)}</dd>
                <dt>已退回</dt><dd>{money(s.refundAmount, s.currency)}</dd>
              </>
            )}
            {s.adjustment !== 0 && (<><dt>账单补差</dt><dd>{money(s.adjustment, s.currency)}</dd></>)}
            <dt>系统单号</dt><dd>{s.customNo}</dd>
            <dt>下单时间</dt><dd>{s.createdAt} UTC</dd>
            {s.remark && (<><dt>备注</dt><dd>{s.remark}</dd></>)}
          </dl>
          {adjustments.length > 0 && (
            <>
              <h3>账单补差</h3>
              <table>
                <tbody>
                  {adjustments.map((a) => (
                    <tr key={a.id}><td className="small">{a.reason}</td><td className="num">{money(a.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      <div className="grid2">
        <div className="card"><h2>寄件人</h2><Addr a={s.sender} /></div>
        <div className="card"><h2>收件人</h2><Addr a={s.recipient} /></div>
      </div>
      <div className="card">
        <h2>包裹</h2>
        <p>{s.pkg.length} × {s.pkg.width} × {s.pkg.height} {lu}，{s.pkg.weight} {wu} · {SIGN[s.pkg.signServiceType] ?? ""}</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>SKU</th><th>品名</th><th>海关编码</th><th className="num">数量</th><th className="num">申报单价</th></tr></thead>
            <tbody>
              {s.skuList.map((k, i) => (
                <tr key={i}><td>{k.sku}</td><td>{k.productNameCn} / {k.productNameEn}</td><td>{k.hsCode}</td><td className="num">{k.quantity}</td><td className="num">{money(k.declaredUnitPrice, k.declaredCurrency)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
