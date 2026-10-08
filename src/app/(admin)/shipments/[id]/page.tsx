import LabelActions from "@/components/LabelActions";
import TrackingLink from "@/components/TrackingLink";
import { dhlDocInfo, isDhlCode } from "@/lib/shipbest/dhl";
import { fmtTime, TZ_LABEL } from "@/lib/time";
import Link from "next/link";
import { MARKUP_SOURCE_LABEL, type MarkupSource } from "@/lib/markup";
import { notFound } from "next/navigation";
import { getCustomer, getSettings, getShipment, isInternalCustomer, listAdjustments, replacedFrom, shipmentProfit, STATUS_LABEL } from "@/lib/db";
import { isPaperSize } from "@/lib/labelLayout";
import { money, signedPercent } from "@/lib/pricing";
import { defaultCancelFees, JG_LABEL_TIMEOUT_MIN, JG_LABEL_TIMEOUT_MSG, JG_TIMEOUT_VOIDED_MSG, providerOf } from "@/lib/service";
import { listProviderEvents } from "@/lib/providerLog";
import { isJiaguCode, jgOrders, jiaguConfig, orderWarehouse, parseJgCode } from "@/lib/shipbest/jiagu";
import { stripProviderTag } from "@/lib/carriers";
import CopyText from "@/components/CopyText";
import { SB_STATUS, type Address } from "@/lib/shipbest/types";
import FlashForm from "@/components/FlashForm";
import StatusBadge from "@/components/StatusBadge";
import Profit from "@/components/Profit";
import { cancelWindowHours, cancelWindowPassed } from "@/lib/portal";
import { cancelAction, confirmCancelAction, refreshAction, saveLabelNoteAction, withdrawCancelAction } from "@/app/actions";
import { stampFor, stampText } from "@/lib/stamp";
import { LEDGER_TYPE_LABEL, listLedger } from "@/lib/ledger";
import { getLang } from "@/lib/prefs";
import { makeT, translateMessage, type T } from "@/lib/i18n";
import PiecesInfo from "@/components/PiecesInfo";

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
const natureLabel = (t: T, v?: string | null) => (v ?? "").split(",").filter(Boolean).map((c) => (NATURE_LABEL[c.trim()] ? t(NATURE_LABEL[c.trim()]) : c)).join(t("、"));

export default async function ShipmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const s = getShipment(Number((await params).id));
  if (!s) notFound();
  const lang = await getLang();
  const t = makeT(lang);
  const tm = (m: string | null) => (m ? m.split("；").map((x) => translateMessage(lang, x)).join(t("；")) : m);
  const [wu, lu] = UNITS[s.pkg.displayUnitSystem];
  const fees = defaultCancelFees(s);
  const adjustments = listAdjustments({ shipmentId: s.id });
  const stampCfg = stampFor(s);
  const charges = listLedger({ shipmentId: s.id }).reverse();
  const canCancel = s.status === "pending" || s.status === "labeled" || s.status === "exception";

  // 服务商反馈：对方单号、仓库、每次返回的内容，外加一段可以直接发给服务商的说明
  const jg = isJiaguCode(s.channelCode);
  const provider = providerOf(s.channelCode);
  const events = listProviderEvents(s.customNo);
  const providerNo = jg ? jgOrders.get(s.customNo)?.identifier ?? null : s.orderNo;
  const productId = jg ? String(parseJgCode(s.channelCode).productId) : s.channelCode;
  const jgCfg = jg ? jiaguConfig() : null;
  const warehouse = jgCfg ? orderWarehouse(jgCfg, s.customNo, s.channelCode) : null;
  const problem =
    s.errorMsg === JG_LABEL_TIMEOUT_MSG || s.errorMsg === JG_TIMEOUT_VOIDED_MSG ? `下单 ${JG_LABEL_TIMEOUT_MIN} 分钟后仍没有面单`
    : s.errorMsg ? s.errorMsg
    : STATUS_LABEL[s.status];
  const troubled = ["pending", "exception", "cancel_requested"].includes(s.status);
  const evLine = (e: (typeof events)[number]) =>
    `- ${fmtTime(e.firstAt)}${e.times > 1 ? ` ~ ${fmtTime(e.lastAt).slice(11)}（${e.times} 次）` : ""} ${e.action}：${e.code ? `[${e.code}] ` : ""}${e.message}`;
  const providerText = [
    "您好，麻烦帮忙查一下这单：",
    `订单号（我们提交的 ${jg ? "OrderNbr" : "customNo"}）：${s.customNo}`,
    providerNo ? `${provider}单号：${providerNo}` : "",
    s.trackingNo ? `运单号：${s.trackingNo}` : "",
    `渠道：${stripProviderTag(s.channelName ?? s.channelCode)}（产品 ID ${productId}${warehouse ? `，仓库 ${warehouse}` : ""}）`,
    `下单时间：${fmtTime(s.createdAt)}（${TZ_LABEL}）`,
    `收件邮编：${s.recipient.zipCode} ${s.recipient.country}`,
    `问题：${problem}`,
    events.length ? `系统收到的返回：\n${events.slice(-6).map(evLine).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{t("面单 {no}", { no: s.customNo })} <StatusBadge status={s.status} test={s.isTest} /></h1>
        <Link href="/shipments">{t("← 返回列表")}</Link>
      </div>

      {/* 已经修改后重新下单、原单也取消了：下面那条“新单”提示就够了 */}
      {s.errorMsg && !(s.replacedBy && s.status === "cancelled") && <div className={`alert ${s.status === "exception" ? "err" : "warn"}`}>{tm(s.errorMsg)}</div>}
      {s.status === "exception" && !s.replacedBy && (
        <div className="card resubmit-cta">
          <div>
            <b>{t("知道异常原因了？")}</b>
            <p className="small muted" style={{ margin: "2px 0 0" }}>{t("比如体积、重量填错了：修改后重新下单，原订单的信息会自动带过去。新单出单成功后，这张异常单自动取消，费用退回。")}</p>
          </div>
          <Link className="btn primary" href={`/shipments/${s.id}/resubmit`}>{t("修改后重新下单")}</Link>
        </div>
      )}
      {s.status === "cancelled" && !s.replacedBy && (
        <div className="card resubmit-cta">
          <div>
            <b>{t("需要重新下单？")}</b>
            <p className="small muted" style={{ margin: "2px 0 0" }}>{t("原订单的地址、包裹、商品会自动带过去，订单号默认在原单号后面加字母（可以改），重新查询运费出单。")}</p>
          </div>
          <Link className="btn primary" href={`/shipments/${s.id}/resubmit`}>{t("重新下单")}</Link>
        </div>
      )}
      {s.replacedBy && (() => {
        const n = getShipment(s.replacedBy);
        return <div className="alert ok">{t("这张订单已经修改后重新下单")}{t("：")}<Link href={`/shipments/${s.replacedBy}`}>{t("新单 {no} →", { no: n?.customNo ?? String(s.replacedBy) })}</Link></div>;
      })()}
      {(() => {
        const from = replacedFrom(s.id);
        return from ? <div className="alert">{t("由异常单修改后重新下单")}{t("：")}<Link href={`/shipments/${from.id}`}>{t("原单 {no}", { no: from.customNo })}</Link></div> : null;
      })()}

      <div className="grid2">
        <div className="card">
          <h2>{t("面单")}</h2>
          {s.labelPath && s.status === "cancelled" ? (
            <>
              <div className="alert err">{t("这张面单已取消作废，不能再打印使用。下面是印了 VOID 的留档。")}</div>
              <iframe src={`/api/labels/${s.id}`} style={{ width: "100%", height: 480, border: "1px solid var(--line)", borderRadius: 8 }} />
            </>
          ) : s.labelPath ? (
            <>
              {s.status === "cancel_requested" && <div className="alert warn">{t("已申请取消：在 {p} 确认取消前请不要使用这张面单。", { p: provider })}</div>}
              {s.labelMime === "application/pdf" ? (
                <LabelActions
                  id={s.id}
                  defaultPaper={(() => {
                    // 默认按这个客户设置的纸张
                    const p = getCustomer(s.customerId)?.labelPaper;
                    return isPaperSize(p) ? p : "4x6";
                  })()}
                  extra={stampCfg ? <a className="btn" href={`/api/labels/${s.id}?raw=1`} target="_blank">{t("原始面单（不加印）")}</a> : null}
                />
              ) : s.labelMime?.startsWith("image/") ? (
                <>
                  <div className="row" style={{ marginBottom: 12 }}>
                    <a className="btn primary" href={`/api/labels/${s.id}`} target="_blank">{t("打开 / 打印")}</a>
                    <a className="btn" href={`/api/labels/${s.id}?download=1`}>{t("下载")}</a>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/labels/${s.id}`} alt="label" style={{ maxWidth: "100%", border: "1px solid var(--line)" }} />
                </>
              ) : null}
              {(() => {
                // DHL 国际件：商业发票（报关用）
                const inv = isDhlCode(s.channelCode) ? dhlDocInfo(s.customNo) : null;
                if (!inv?.hasInvoice) return null;
                return (
                  <div className={`alert ${inv.paperless ? "ok" : "warn"}`} style={{ marginTop: 12 }}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <span>{inv.paperless ? t("商业发票已通过 DHL 电子发票（Paperless Trade）传送，不用打印随货；需要留底可以下载。") : t("这个目的地不支持电子发票：请把商业发票打印 3 份，放进包裹外的透明袋里随货。")}</span>
                      <span className="row">
                        <a className="btn small" href={`/api/labels/${s.id}/invoice`} target="_blank">{t("商业发票")}</a>
                        <a className="btn small" href={`/api/labels/${s.id}/invoice?download=1`}>{t("下载")}</a>
                      </span>
                    </div>
                  </div>
                );
              })()}
            </>
          ) : (
            <p className="muted">{s.status === "cancelled" ? t("这张单已取消，没有面单。") : s.status === "exception" ? t("出单异常，没有面单。") : t("面单尚未生成。{p} 一般几秒内出单，可点“刷新状态”。", { p: provider })}</p>
          )}
          {s.labelSku && (
            <p className="small muted" style={{ margin: "8px 0" }}>
              {t("自动检查")}{t("：")}
              {s.labelSku === "yes" ? t("面单上已有这一单的 SKU，不加印") : s.labelSku === "no" ? t("面单上没有 SKU，打印时自动加印") : t("图片面单，读不出文字，按渠道 / 全局设置加印")}
            </p>
          )}
          <FlashForm action={saveLabelNoteAction} submitLabel="保存" submitClass="small" className="row">
            <input type="hidden" name="id" value={s.id} />
            <label className="f" style={{ flex: 1, minWidth: 220 }}>
              {t("面单加印文字")}{stampCfg ? "" : t("（这个客户当前不加印）")}
              <input name="labelNote" maxLength={200} defaultValue={s.labelNote ?? ""} placeholder={stampText({ ...s, labelNote: null }, stampCfg ?? getSettings().stamp) || t("留空则印 SKU")} />
            </label>
          </FlashForm>
          <div className="row" style={{ marginTop: 12 }}>
            <FlashForm action={refreshAction} submitLabel="刷新状态" submitClass="" inline>
              <input type="hidden" name="id" value={s.id} />
            </FlashForm>
            {canCancel && (
              <FlashForm action={cancelAction} submitLabel="申请取消" submitClass="danger" inline
                confirm={cancelWindowPassed(s.createdAt)
                  ? "这张面单下单已超过可取消时限，服务商可能不接受取消。确定仍要申请取消吗？"
                  : t("确认取消这张面单？会先通过接口向 {p} 取消；接口取消不了的，要联系 {p} 人工取消，可能收取取消费。", { p: provider })}>
                <input type="hidden" name="id" value={s.id} />
              </FlashForm>
            )}
          </div>
          {canCancel && cancelWindowPassed(s.createdAt) && (
            <p className="small warn-text" style={{ marginTop: 8 }}>{t("下单已超过 {h} 小时（可取消时限），客户端已不能申请取消。", { h: cancelWindowHours() })}</p>
          )}
          {s.status === "cancel_requested" && (
            <div className="card" style={{ marginTop: 12, background: "var(--warn-soft)" }}>
              <h2>{t("确认已取消")}</h2>
              <p className="small">{isInternalCustomer(s.customerId) ? t("接口没能直接取消，要联系 {p} 人工取消。{p} 确认取消后，填写服务商收取的取消费并点“确认已取消”（公司自用账户不扣余额，不用退款）。", { p: provider }) : t("接口没能直接取消，要联系 {p} 人工取消。{p} 确认取消后，填写费用并点“确认已取消”。退款 = 客户价 - 客户取消手续费。", { p: provider })}</p>
              <div className="row" style={{ marginBottom: 10 }}>
                <FlashForm action={cancelAction} submitLabel="再通过接口取消一次" submitClass="small" inline confirm={t("再向 {p} 发一次取消请求？成功就直接取消并退款。", { p: provider })}>
                  <input type="hidden" name="id" value={s.id} />
                </FlashForm>
              </div>
              <FlashForm action={confirmCancelAction} submitLabel="确认已取消" review alwaysSubmit confirm={isInternalCustomer(s.customerId) ? t("确认这张面单已经作废？公司自用账户不扣余额，也不用退款。确认后不能撤回。") : t("作废这张面单并退款给【{name}】：退款 = 客户价 {price} − 客户取消手续费。确认后不能撤回。", { name: s.customerName ?? "", price: money(s.price, s.currency) })}>
                <input type="hidden" name="id" value={s.id} />
                <div className="row" style={{ marginBottom: 8 }}>
                  {isInternalCustomer(s.customerId) ? (
                    <input type="hidden" name="cancelFee" value="0" />
                  ) : (
                    <label className="f">{t("向客户收取的取消手续费")}<input name="cancelFee" type="number" step="0.01" min={0} max={s.price} defaultValue={fees.cancelFee} /><span className="field-hint muted">{t("不能超过客户价 {price}", { price: money(s.price, s.currency) })}</span></label>
                  )}
                  <label className="f">{t("{p} 收取的取消费", { p: provider })}<input name="sbCancelFee" type="number" step="0.01" defaultValue={fees.sbCancelFee} /><span className="field-hint muted">{t("预填的是按比例估算的金额，请按 {p} 实际收取的填写", { p: provider })}</span></label>
                </div>
              </FlashForm>
              <p className="small muted" style={{ marginTop: 12 }}>{t("{p} 拒绝取消、或者申请错了：", { p: provider })}</p>
              <FlashForm action={withdrawCancelAction} submitLabel="撤回取消申请" submitClass="" confirm="撤回后面单恢复为“已出面单”，客户可以继续使用。确定？">
                <input type="hidden" name="id" value={s.id} />
              </FlashForm>
            </div>
          )}
        </div>

        <div className="card">
          <h2>{t("费用")}</h2>
          <dl className="kv">
            <dt>{t("客户")}</dt><dd>{s.customerName}</dd>
            <dt>{t("渠道")}</dt><dd>{s.channelName} <span className="muted small">({s.channelCode})</span></dd>
            <dt>{t("分区")}</dt><dd>{s.zone ?? "-"}</dd>
            <dt>{t("试算成本")}</dt><dd>{money(s.quotedCost, s.currency)}</dd>
            <dt>{t("实扣成本")}</dt><dd>{money(s.actualCost, s.currency)}{s.actualCost !== null && Math.abs(s.actualCost - s.quotedCost) > 0.005 && <span className="profit-neg small">{t("（与试算不同）")}</span>}</dd>
            <dt>{t("加价规则")}</dt><dd>{t("{pct} + {fixed}，最低利润 {min}", { pct: signedPercent(s.rule.percent), fixed: money(s.rule.fixed), min: money(s.rule.minProfit) })}{s.rule.source ? <span className="small muted"> · {t(MARKUP_SOURCE_LABEL[s.rule.source as MarkupSource] ?? s.rule.source)}</span> : null}</dd>
            <dt>{t("客户价")}</dt><dd><b>{money(s.price, s.currency)}</b></dd>
            {s.status === "cancelled" && (
              <>
                <dt>{t("客户取消费")}</dt><dd>{money(s.cancelFee, s.currency)}</dd>
                <dt>{t("{p} 取消费", { p: provider })}</dt><dd>{money(s.sbCancelFee, s.currency)}</dd>
                {!isInternalCustomer(s.customerId) && <><dt>{t("应退客户")}</dt><dd><b>{money(s.refundAmount, s.currency)}</b></dd></>}
              </>
            )}
            {adjustments.length > 0 && (
              <>
                <dt>{t("账单补差")}</dt><dd>{t("{p} {cost} · 向客户 {customer}", { p: provider, cost: money(s.costAdj, s.currency), customer: money(s.customerAdj, s.currency) })}</dd>
              </>
            )}
            <dt>{t("利润")}</dt><dd><Profit value={shipmentProfit(s)} currency={s.currency} /></dd>
          </dl>
          <h3>{t("订单")}</h3>
          <dl className="kv">
            <dt>{t("自定义单号")}</dt><dd>{s.customNo}</dd>
            <dt>{t("服务商")}</dt><dd>{t(provider)}</dd>
            <dt>{t("服务商单号")}</dt><dd>{providerNo ?? "-"}</dd>
            <dt>{t("运单号")}</dt><dd><TrackingLink channelCode={s.channelCode} trackingNo={s.trackingNo} title={t("查物流轨迹")} /></dd>
            <dt>{t("服务商状态")}</dt><dd>{s.sbStatus ? (SB_STATUS[s.sbStatus] ? t(SB_STATUS[s.sbStatus]) : s.sbStatus) : "-"}</dd>
            <dt>{t("创建时间")}</dt><dd>{fmtTime(s.createdAt)}</dd>
            {s.remark && (<><dt>{t("备注")}</dt><dd>{s.remark}</dd></>)}
          </dl>
        </div>
      </div>

      <div className="card" id="provider">
        <h2>{t("服务商反馈")}</h2>
        <p className="small muted">{t("向服务商下单、查面单、取消时对方返回的内容。同样的返回只记一条，显示次数和最后时间。")}</p>
        {events.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t("时间")}</th><th>{t("来源")}</th><th>{t("动作")}</th><th>{t("返回码")}</th><th>{t("返回内容")}</th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="small muted" style={{ whiteSpace: "nowrap" }}>
                      {fmtTime(e.firstAt)}
                      {e.times > 1 && <div>{t("最后 {time} · 共 {n} 次", { time: fmtTime(e.lastAt), n: e.times })}</div>}
                    </td>
                    <td>{t(e.provider)}</td>
                    <td>{t(e.action)}</td>
                    <td className="small">{e.code ?? "-"}</td>
                    <td className="small" style={{ wordBreak: "break-word" }}>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">{t("还没有记录（这个功能上线前下的单没有记录，可以点“刷新状态”查一次）。")}</p>
        )}
        <details open={troubled} style={{ marginTop: 12 }}>
          <summary>{t("发给服务商的问题说明（可复制）")}</summary>
          <CopyText text={providerText} label="复制说明" />
        </details>
      </div>

      {adjustments.length > 0 && (
        <div className="card">
          <h2>{t("官方账单补差")}</h2>
          <table>
            <thead><tr><th>{t("导入时间")}</th><th>{t("批次")}</th><th className="num">{t("{p} 补差", { p: provider })}</th><th className="num">{t("向客户")}</th><th>{t("原因")}</th></tr></thead>
            <tbody>
              {adjustments.map((a) => (
                <tr key={a.id}>
                  <td className="small muted">{fmtTime(a.createdAt)}</td>
                  <td><Link href={`/adjustments/${a.batchId}`}>{a.batchFilename}</Link></td>
                  <td className="num">{money(a.costAmount)}</td>
                  <td className="num">{money(a.customerAmount)}</td>
                  <td className="small">{a.reason ? a.reason.split(" · ").map((x) => translateMessage(lang, x)).join(" · ") : a.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
                  <td className="small">{l.note ? l.note.split(" · ").map((x) => translateMessage(lang, x)).join(" · ") : l.note}</td>
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
        <div className="card">
          <h2>{t("收件人")}</h2>
          <Addr a={s.recipient} />
          {s.addressCheck && (
            <p className={`addr-mini ${["missing_unit", "bad_unit", "not_found"].includes(s.addressCheck.status) ? (s.addressCheck.status === "not_found" ? "err" : "warn") : "ok"}`}>
              {t("下单时地址核对")}{t("：")}{s.addressCheck.message ? t(s.addressCheck.message) : s.addressCheck.status}
              {(s.addressCheck as { acknowledged?: boolean }).acknowledged && <b> · {t("客户已确认地址无误")}</b>}
            </p>
          )}
        </div>
      </div>

      <div className="card">
        <h2>{t("包裹")}</h2>
        <p>
          {s.pkg.length} × {s.pkg.width} × {s.pkg.height} {lu}{t("，")}{s.pkg.weight} {wu} · {t(SIGN[s.pkg.signServiceType])}
          {s.pkg.insuranceService ? ` · ${t("保险")} ${money(s.pkg.insuranceFee ?? 0, s.pkg.currency)}` : ""}
        </p>
        <PiecesInfo pieces={s.pkg.pieces} channelName={s.channelName} />
        <div className="table-wrap">
          <table>
            <thead><tr><th>SKU</th><th>{t("品名")}</th><th>{t("海关编码")}</th><th>{t("性质")}</th><th className="num">{t("数量")}</th><th className="num">{t("申报单价")}</th></tr></thead>
            <tbody>
              {s.skuList.map((k, i) => (
                <tr key={i}>
                  <td>{k.sku}</td><td>{k.productNameCn === k.productNameEn ? k.productNameEn : `${k.productNameCn} / ${k.productNameEn}`}{(k.material || k.originCountry) && <div className="small muted">{[k.material, k.originCountry && `${t("原产国")} ${k.originCountry}`].filter(Boolean).join(" · ")}</div>}</td><td>{k.hsCode}</td><td>{natureLabel(t, k.productNature)}</td>
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
