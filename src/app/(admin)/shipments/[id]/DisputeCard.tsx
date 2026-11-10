import FlashForm from "@/components/FlashForm";
import { createDisputeAction, deleteDisputeAction, loseDisputeAction, reopenDisputeAction, winDisputeAction } from "@/app/disputeActions";
import { DISPUTE_STATUS_LABEL, listDisputes, refundableToCustomer } from "@/lib/disputes";
import { isInternalCustomer, type Shipment } from "@/lib/db";
import { money } from "@/lib/pricing";
import { fmtTime } from "@/lib/time";
import type { T } from "@/lib/i18n";

/** 运费申诉：向服务商申诉收错的费用，成功后按加价比例退给客户 */
export default function DisputeCard({ s, provider, t }: { s: Shipment; provider: string; t: T }) {
  const list = listDisputes({ shipmentId: s.id });
  const pct = Math.max(0, s.rule?.percent ?? 0);
  const max = refundableToCustomer(s);
  const internal = isInternalCustomer(s.customerId);
  const hint = internal
    ? t("公司自用账户：服务商退回的钱只记在成本上，不退给客户。")
    : t("申诉成功后填服务商退回的金额，系统按这一单的加价 {pct}% 退给客户（最多退到客户在这一单上付的 {max}），退款马上记入客户余额并通知客户。", { pct, max: money(max) });
  return (
    <div className="card" id="disputes">
      <h2>{t("运费申诉")}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>{t("觉得哪笔运费 / 附加费收错了，向 {p} 客服申诉时在这里记一笔。", { p: provider })} {hint}</p>

      {list.map((d) => (
        <div key={d.id} className="dispute-item">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <span className={`badge ${d.status === "won" ? "ok" : d.status === "lost" ? "cancelled" : "warn"}`}>{t(DISPUTE_STATUS_LABEL[d.status])}</span>{" "}
              <b>{d.reason}</b>
              {d.claimAmount !== null && <span className="muted"> · {t("申诉金额 {a}", { a: money(d.claimAmount) })}</span>}
              <div className="small muted">{fmtTime(d.createdAt)}{d.createdBy ? ` · ${d.createdBy}` : ""}{d.note ? ` · ${d.note}` : ""}</div>
              {d.status === "won" && (
                <div className="small">{t("服务商退回 {c}，退给客户 {u}", { c: money(d.refundCost), u: money(d.refundCustomer) })}{d.resolvedAt ? <span className="muted"> · {fmtTime(d.resolvedAt)}</span> : null}</div>
              )}
            </div>
            {d.status !== "open" && (
              <FlashForm action={reopenDisputeAction} submitLabel="撤销处理结果" submitClass="small" confirm={d.status === "won" ? t("撤销后退给客户的 {u} 会从客户余额扣回，回到申诉中。确认？", { u: money(d.refundCustomer) }) : undefined}>
                <input type="hidden" name="id" value={d.id} />
              </FlashForm>
            )}
          </div>
          {d.status === "open" && (
            <div className="grid2" style={{ marginTop: 8 }}>
              <FlashForm action={winDisputeAction} submitLabel="申诉成功，退给客户" submitClass="primary small">
                <input type="hidden" name="id" value={d.id} />
                <div className="row">
                  <label className="f"><span className="req">{t("服务商退回")}</span><input name="refundCost" inputMode="decimal" required style={{ width: 110 }} /></label>
                  <label className="f">{t("退给客户")}<input name="refundCustomer" inputMode="decimal" placeholder={internal ? "0" : t("留空按加价 {pct}% 算", { pct })} style={{ width: 150 }} disabled={internal} /></label>
                </div>
                <input name="note" placeholder={t("内部备注（申诉单号等，客户看不到）")} maxLength={500} style={{ marginBottom: 6 }} />
              </FlashForm>
              <div>
                <FlashForm action={loseDisputeAction} submitLabel="申诉未成功" submitClass="small">
                  <input type="hidden" name="id" value={d.id} />
                  <input name="note" placeholder={t("结果，例如：承运商复核后维持原费用")} maxLength={500} style={{ marginBottom: 6 }} />
                </FlashForm>
                <FlashForm action={deleteDisputeAction} submitLabel="删除这条（记错了）" submitClass="small" confirm={t("删除这条申诉记录？")}>
                  <input type="hidden" name="id" value={d.id} />
                </FlashForm>
              </div>
            </div>
          )}
        </div>
      ))}

      <details style={{ marginTop: list.length ? 12 : 0 }}>
        <summary>{t("记录一笔申诉")}</summary>
        <FlashForm action={createDisputeAction} submitLabel="记录申诉" submitClass="small" resetOnSuccess>
          <input type="hidden" name="shipmentId" value={s.id} />
          <label className="f"><span className="req">{t("申诉的费用（客户看得到，会作为退款说明）")}</span>
            <input name="reason" required maxLength={200} placeholder={t("例如：超偏远费收错，地址不在偏远地区")} />
          </label>
          <div className="row">
            <label className="f">{t("申诉金额（可不填）")}<input name="claimAmount" inputMode="decimal" style={{ width: 120 }} /></label>
            <label className="f">{t("服务商已退回（已经成功才填）")}<input name="refundCost" inputMode="decimal" style={{ width: 120 }} /></label>
            <label className="f">{t("退给客户")}<input name="refundCustomer" inputMode="decimal" placeholder={internal ? "0" : t("留空按加价 {pct}% 算", { pct })} style={{ width: 150 }} disabled={internal} /></label>
          </div>
          <input name="note" placeholder={t("内部备注（申诉单号等，客户看不到）")} maxLength={500} style={{ marginBottom: 6 }} />
        </FlashForm>
      </details>
    </div>
  );
}
