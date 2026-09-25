"use client";

import { useState } from "react";
import { parseAddress } from "@/lib/addressParse";
import type { Address } from "@/lib/shipbest/types";

const FIELDS: { k: keyof Address; label: string; req?: boolean; wide?: boolean; ph?: string }[] = [
  { k: "nameFirst", label: "名 First name", req: true },
  { k: "nameLast", label: "姓 Last name", req: true },
  { k: "corporateName", label: "公司" },
  { k: "phone", label: "电话" },
  { k: "email", label: "邮箱" },
  { k: "country", label: "国家二字码", req: true, ph: "US" },
  { k: "province", label: "州/省", ph: "CA" },
  { k: "city", label: "城市", req: true },
  { k: "zipCode", label: "邮编", req: true },
  { k: "address1", label: "地址1", req: true, wide: true },
  { k: "address2", label: "地址2", wide: true },
];

/**
 * 地址输入。传 onChange 时为受控组件（新建面单页），
 * 否则为普通表单字段，name 为 `${namePrefix}${字段}`（设置页）。
 */
export default function AddressFields({
  value,
  onChange,
  namePrefix = "",
}: {
  value?: Partial<Address> | null;
  onChange?: (a: Partial<Address>) => void;
  namePrefix?: string;
}) {
  return (
    <>
      {onChange && <SmartPaste onParsed={(p) => onChange({ ...value, ...p })} />}
      <div className="grid">
      {FIELDS.map((f) => (
        <label key={f.k} className="f" style={f.wide ? { gridColumn: "span 2" } : undefined}>
          <span className={f.req ? "req" : ""}>{f.label}</span>
          {onChange ? (
            <input
              value={value?.[f.k] ?? ""}
              placeholder={f.ph}
              maxLength={f.k === "country" ? 2 : f.wide ? 100 : 50}
              onChange={(e) => onChange({ ...value, [f.k]: e.target.value })}
            />
          ) : (
            <input name={namePrefix + f.k} defaultValue={value?.[f.k] ?? ""} placeholder={f.ph} maxLength={f.k === "country" ? 2 : f.wide ? 100 : 50} />
          )}
        </label>
      ))}
      </div>
    </>
  );
}

/** 智能识别：粘贴一段复制来的地址，自动拆到各个字段 */
function SmartPaste({ onParsed }: { onParsed: (a: Partial<Address>) => void }) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const run = (t: string) => {
    const p = parseAddress(t);
    const n = Object.keys(p).length;
    if (!n) return setMsg("没有识别出地址，请检查粘贴的内容");
    onParsed(p);
    const missing = (["nameFirst", "address1", "city", "province", "zipCode"] as const).filter((k) => !p[k]);
    setMsg(missing.length ? `已识别 ${n} 项，请补充：${missing.map((k) => ({ nameFirst: "姓名", address1: "地址", city: "城市", province: "州", zipCode: "邮编" })[k]).join("、")}` : `已识别 ${n} 项，请核对一下`);
  };
  return (
    <div className="smart-paste">
      <textarea
        rows={2}
        value={text}
        placeholder={"智能识别：把复制的整段地址粘贴到这里，例如\nJohn Doe, 500 Congress Ave, Austin, TX 78701, 512-555-0100"}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          // 粘贴后自动识别
          const t = e.clipboardData.getData("text");
          if (t) setTimeout(() => run(t), 0);
        }}
      />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="small muted">{msg ?? "粘贴后自动识别姓名、电话、邮箱、地址、城市、州、邮编"}</span>
        <div className="row">
          {text && <button type="button" className="small" onClick={() => { setText(""); setMsg(null); }}>清空</button>}
          <button type="button" className="small" disabled={!text.trim()} onClick={() => run(text)}>识别</button>
        </div>
      </div>
    </div>
  );
}
