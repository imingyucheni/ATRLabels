"use client";

import { CheckCircle2, MapPinOff, TriangleAlert, Wand2 } from "lucide-react";
import { useT, useTMsg } from "@/components/I18n";
import type { AddressCheck } from "@/lib/addressCheck";
import type { Address } from "@/lib/shipbest/types";

const line = (a: Partial<Address>) =>
  [[a.address1, a.address2].filter(Boolean).join(", "), [a.city, [a.province, a.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(" · ");

/** 收件地址核对结果：正确 / 建议写法 / 缺公寓号 / 查不到（后两种要客户确认才能下单） */
export default function AddressCheckPanel({
  check,
  ack,
  onAck,
  onUse,
}: {
  check: AddressCheck;
  ack?: boolean;
  onAck?: (v: boolean) => void;
  onUse?: (a: Partial<Address>) => void;
}) {
  const t = useT();
  const tm = useTMsg();
  const kind = check.status === "ok" ? "ok" : check.status === "corrected" ? "info" : check.status === "not_found" ? "err" : "warn";
  const Icon = kind === "ok" ? CheckCircle2 : kind === "info" ? Wand2 : kind === "err" ? MapPinOff : TriangleAlert;
  const needAck = ["missing_unit", "bad_unit", "not_found"].includes(check.status);
  return (
    <div id="addr-check" className={`addr-check ${kind}`}>
      <div className="addr-check-head">
        <Icon size={16} strokeWidth={2.2} />
        <b>{t("收件地址核对")}</b>
        <span>{tm(check.message) || ""}</span>
        {check.business !== undefined && check.status !== "not_found" && (
          <span className="badge">{check.business ? t("商业地址") : t("住宅地址")}</span>
        )}
      </div>
      {check.suggestion && (
        <div className="addr-suggest">
          <span className="small muted">{t("建议地址")}</span>
          <span className="addr-line">{line(check.suggestion)}</span>
          {onUse && <button type="button" className="small" onClick={() => onUse(check.suggestion!)}>{t("使用建议地址")}</button>}
        </div>
      )}
      {needAck && onAck && (
        <label className="addr-ack">
          <input type="checkbox" checked={!!ack} onChange={(e) => onAck(e.target.checked)} />
          <span>{t("我确认地址无误，继续下单（地址错误导致的退件、改地址等费用可能会从余额扣除）")}</span>
        </label>
      )}
    </div>
  );
}
