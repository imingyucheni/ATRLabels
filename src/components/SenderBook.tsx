"use client";

import { useState, useTransition } from "react";
import AddressFields, { SENDER_EXAMPLE } from "@/components/AddressFields";
import { useT, useTMsg } from "@/components/I18n";
import { deleteSenderAction, saveSenderBookAction, setDefaultSenderAction } from "@/app/portal/actions";
import type { SavedSender } from "@/lib/senders";
import type { Address } from "@/lib/shipbest/types";

const oneLine = (a: Partial<Address>) =>
  [a.corporateName, a.address1, a.address2, [a.city, a.province, a.zipCode].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ");

/** 客户的寄件地址簿：保存多个寄件地址，设置默认，下单时直接选 */
export default function SenderBook({ initial }: { initial: SavedSender[] }) {
  const t = useT();
  const tm = useTMsg();
  const [list, setList] = useState(initial);
  const [edit, setEdit] = useState<{ id?: number; label: string; address: Partial<Address>; makeDefault: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{t("寄件地址簿")}</h2>
        {!edit && (
          <button className="primary small" onClick={() => setEdit({ label: "", address: { country: "US" }, makeDefault: !list.length })}>{t("＋ 新增寄件地址")}</button>
        )}
      </div>
      <p className="small muted">{t("保存常用的寄件地址，下单时直接选择；默认地址会自动填入，批量导入表格没填寄件人时也用它。")}</p>
      {error && <div className="alert err">{tm(error)}</div>}

      {edit && (
        <div className="sender-edit">
          <label className="f" style={{ maxWidth: 320, marginBottom: 12 }}>{t("地址名称（可选，例如“洛杉矶仓”）")}
            <input value={edit.label} maxLength={50} onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
          </label>
          <AddressFields value={edit.address} placeholders={SENDER_EXAMPLE} onChange={(a) => setEdit({ ...edit, address: a })} />
          <div className="row" style={{ marginTop: 12 }}>
            <label className="small"><input type="checkbox" checked={edit.makeDefault} onChange={(e) => setEdit({ ...edit, makeDefault: e.target.checked })} /> {t("设为默认")}</label>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const r = await saveSenderBookAction(edit);
                  if (r.error) return setError(r.error);
                  setError(null);
                  setList(r.senders!);
                  setEdit(null);
                })
              }
            >
              {busy ? t("保存中…") : t("保存")}
            </button>
            <button onClick={() => { setEdit(null); setError(null); }} disabled={busy}>{t("取消")}</button>
          </div>
        </div>
      )}

      <div className="sender-list">
        {list.map((s) => (
          <div key={s.id} className={`sender-item ${s.isDefault ? "default" : ""}`}>
            <div>
              <div><b>{s.label}</b> {s.isDefault && <span className="badge ok">{t("默认")}</span>}</div>
              <div className="small">{s.address.nameFirst} {s.address.nameLast}{s.address.phone ? ` · ${s.address.phone}` : ""}</div>
              <div className="small muted">{oneLine(s.address)}</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {!s.isDefault && (
                <button className="small" disabled={busy} onClick={() => start(async () => setList((await setDefaultSenderAction(s.id)).senders))}>{t("设为默认")}</button>
              )}
              <button className="small" disabled={busy} onClick={() => setEdit({ id: s.id, label: s.label, address: s.address, makeDefault: s.isDefault })}>{t("编辑")}</button>
              <button
                className="small danger"
                disabled={busy}
                onClick={() => window.confirm(t("删除“{name}”？", { name: s.label })) && start(async () => setList((await deleteSenderAction(s.id)).senders))}
              >
                {t("删除")}
              </button>
            </div>
          </div>
        ))}
        {!list.length && !edit && <div className="muted small">{t("还没有保存寄件地址。没有设置时，下单使用系统默认的发货仓地址。")}</div>}
      </div>
    </div>
  );
}
