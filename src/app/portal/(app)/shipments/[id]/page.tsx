import { fmtTime } from "@/lib/time";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/auth";
import { getOwnShipment, listOwnAdjustments, portalCancelFeePercent } from "@/lib/portal";
import { money } from "@/lib/pricing";
import { LEDGER_TYPE_LABEL, listLedger } from "@/lib/ledger";
import type { Address } from "@/lib/shipbest/types";
import FlashForm from "@/components/FlashForm";
import StatusBadge from "@/components/StatusBadge";
import { portalCancelAction, portalRefreshAction, portalSaveLabelNoteAction } from "@/app/portal/actions";
import { isPaperSize, PAPER_LABEL } from "@/lib/labelLayout";
import { getSettings } from "@/lib/db";
import { makeT, translateMessage, type T } from "@/lib/i18n";
import { getLang } from "@/lib/prefs";

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
  // 未出单 / 已出面单的订单客户可以自己申请取消；异常单请联系客服
  const canCancel = s.status === "pending" || s.status === "labeled";
  const paper = isPaperSize(me.labelPaper) ? me.labelPaper : "4x6";
  const feePct = portalCancelFeePercent();
  const contact = getSettings().supportContact;
  const charges = listLedger({ shipmentId: s.id }).filter((l) => l.customerId === me.id).reverse();
  const lang = await getLang();
  const t: T = makeT(lang);
  const tm = (m: string | null) => translateMessage(lang, m);
  // 补差原因 / 扣款说明可能是“a · b”拼起来的，逐段翻译（中文原样）
  const tp = (m: string | null) => (m ? m.split(" · ").map((x) => translateMessage(lang, x)).join(" · ") : m);

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{s.customerRef || s.customNo} <StatusBadge status={s.status} test={s.isTest} /></h1>
        <Link href="/portal/shipments">{t("← 返回列表")}</Link>
      </div>
      {s.problem && <div className="alert err">{t("订单异常：{problem}。请联系客服处理{contact}，未出面单的订单运费会全额退回。", { problem: tm(s.problem), contact: contact ? t("（{contact}）", { contact }) : "" })}</div>}
      {s.status === "exception" && (
        <div className="alert warn">
          {t("这张订单已付款出单，如需取消请联系客服{contact}。取消后运费退回账户余额（已出面单的收取 {pct}% 手续费）。", { contact: contact ? `${t("：")}${contact}` : "", pct: feePct })}
        </div>
      )}
      {s.status === "cancel_requested" && <div className="alert warn">{t("取消申请处理中，完成后费用会退回账户余额。")}</div>}

      <div className="grid2">
        <div className="card">
          <h2>{t("面单")}</h2>
          {s.hasLabel ? (
            <>
              <div className="row" style={{ marginBottom: 12 }}>
                <a className="btn primary" href={`/api/labels/${s.id}`} target="_blank">{t("打开 / 打印面单 · {paper}", { paper: t(PAPER_LABEL[paper]).replace(/\s*[（(](默认|default)[）)]/, "") })}</a>
                <a className="btn" href={`/api/labels/${s.id}?download=1`}>{t("下载")}</a>
              </div>
              {s.labelMime === "application/pdf" && (
                <iframe src={`/api/labels/${s.id}`} style={{ width: "100%", height: 480, border: "1px solid var(--line)", borderRadius: 8 }} />
              )}
            </>
          ) : s.status === "cancelled" ? (
            <p className="muted">{t("这张面单已取消作废，不能再打印使用。")}</p>
          ) : s.status === "pending" ? (
            <p className="muted">{t("面单生成中，一般几秒到一分钟。可以点“刷新”。")}</p>
          ) : (
            <p className="muted">{t("没有面单。")}</p>
          )}
          {s.stampOn && s.status !== "cancelled" && (
            <FlashForm action={portalSaveLabelNoteAction} submitLabel={t("保存")} submitClass="small" className="row">
              <input type="hidden" name="id" value={s.id} />
              <label className="f" style={{ flex: 1, minWidth: 220 }}>
                {t("面单上加印的文字（留空则印 SKU）")}
                <input name="labelNote" maxLength={200} defaultValue={s.labelNote ?? ""} placeholder={s.stampText} />
              </label>
            </FlashForm>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            {s.status === "pending" && (
              <FlashForm action={portalRefreshAction} submitLabel={t("刷新")} submitClass="" inline>
                <input type="hidden" name="id" value={s.id} />
              </FlashForm>
            )}
            {canCancel && (
              <FlashForm
                action={portalCancelAction}
                submitLabel={t("申请取消")}
                submitClass="danger"
                inline
                confirm={
                  s.hasLabel || s.trackingNo
                    ? t("确认申请取消这张面单？面单已生成，取消后收取 {pct}% 取消手续费，其余运费退回账户余额。取消处理完成前请不要使用这张面单。", { pct: feePct })
                    : t("确认申请取消这张订单？面单还没生成，取消后运费全额退回账户余额。")
                }
              >
                <input type="hidden" name="id" value={s.id} />
              </FlashForm>
            )}
          </div>
          {canCancel && (
            <p className="small muted" style={{ marginTop: 8 }}>
              {t("不需要这张面单了可以点“申请取消”：未出面单的全额退款；已出面单的收取 {pct}% 手续费。", { pct: feePct })}
            </p>
          )}
        </div>

        <div className="card">
          <h2>{t("费用")}</h2>
          <dl className="kv">
            <dt>{t("渠道")}</dt><dd>{s.channelName}</dd>
            <dt>{t("分区")}</dt><dd>{s.zone ?? "-"}</dd>
            <dt>{t("运单号")}</dt><dd>{s.trackingNo ?? "-"}</dd>
            <dt>{t("运费")}</dt><dd><b>{money(s.price, s.currency)}</b></dd>
            {s.status === "cancelled" && (
              <>
                <dt>{t("取消手续费")}</dt><dd>{money(s.cancelFee, s.currency)}</dd>
                <dt>{t("已退回")}</dt><dd>{money(s.refundAmount, s.currency)}</dd>
              </>
            )}
            {s.adjustment !== 0 && (<><dt>{t("账单补差")}</dt><dd>{money(s.adjustment, s.currency)}</dd></>)}
            <dt>{t("系统单号")}</dt><dd>{s.customNo}</dd>
            <dt>{t("下单时间")}</dt><dd>{fmtTime(s.createdAt)}</dd>
            {s.remark && (<><dt>{t("备注")}</dt><dd>{s.remark}</dd></>)}
          </dl>
          {adjustments.length > 0 && (
            <>
              <h3>{t("账单补差")}</h3>
              <table>
                <tbody>
                  {adjustments.map((a) => (
                    <tr key={a.id}><td className="small">{tp(a.reason)}</td><td className="num">{money(a.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      {charges.length > 0 && (
        <div className="card">
          <h2>{t("这一单的扣款记录")}</h2>
          <table>
            <thead><tr><th>{t("时间")}</th><th>{t("类型")}</th><th>{t("说明")}</th><th className="num">{t("金额")}</th></tr></thead>
            <tbody>
              {charges.map((l) => (
                <tr key={l.id}>
                  <td className="small muted">{fmtTime(l.createdAt)}</td>
                  <td>{t(LEDGER_TYPE_LABEL[l.type])}</td>
                  <td className="small">{tp(l.note)}</td>
                  <td className={`num ${l.amount >= 0 ? "profit-pos" : ""}`}>{l.amount >= 0 ? "+" : ""}{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}><b>{t("合计扣款")}</b></td><td className="num"><b>{money(-charges.reduce((a, l) => a + l.amount, 0))}</b></td></tr></tfoot>
          </table>
        </div>
      )}

      <div className="grid2">
        <div className="card"><h2>{t("寄件人")}</h2><Addr a={s.sender} /></div>
        <div className="card"><h2>{t("收件人")}</h2><Addr a={s.recipient} /></div>
      </div>
      <div className="card">
        <h2>{t("包裹")}</h2>
        <p>{s.pkg.length} × {s.pkg.width} × {s.pkg.height} {lu}{t("，")}{s.pkg.weight} {wu} · {SIGN[s.pkg.signServiceType] ? t(SIGN[s.pkg.signServiceType]) : ""}</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>SKU</th><th>{t("品名")}</th><th>{t("海关编码")}</th><th className="num">{t("数量")}</th><th className="num">{t("申报单价")}</th></tr></thead>
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
