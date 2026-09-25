"use client";

import { useEffect, useState } from "react";
import { parseAddress } from "@/lib/addressParse";
import { useT } from "@/components/I18n";
import { COMMON_COUNTRIES, isCountryCode, isUsZip, US_STATES, usStateCode } from "@/lib/geo";
import type { Address } from "@/lib/shipbest/types";

type Field = { k: keyof Address; label: string; req?: boolean; wide?: boolean; ph?: string };

const FIELDS: Field[] = [
  { k: "nameFirst", label: "名 First name", req: true },
  { k: "nameLast", label: "姓 Last name", req: true },
  { k: "corporateName", label: "公司" },
  { k: "phone", label: "电话" },
  { k: "email", label: "邮箱" },
  { k: "country", label: "国家", req: true },
  { k: "province", label: "州/省", req: true },
  { k: "city", label: "城市", req: true },
  { k: "zipCode", label: "邮编", req: true },
  { k: "address1", label: "地址1", req: true, wide: true },
  { k: "address2", label: "地址2（公寓 / 单元号，可选）", wide: true },
];

const COMMON_CODES = new Set(COMMON_COUNTRIES.map(([c]) => c));

/**
 * 地址输入。传 onChange 时为受控组件（下单页），
 * 否则为普通表单字段，name 为 `${namePrefix}${字段}`（设置页）。
 * 国家默认 US、从下拉框选；美国地址的州从下拉框选；填了认不出的值会当场提示。
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
  const t = useT();
  const controlled = !!onChange;
  // 选了“其他国家”正在输入时，不要把空国家自动改回 US
  const [otherMode, setOtherMode] = useState(!!value?.country && !COMMON_CODES.has(value.country.toUpperCase()));
  // 受控时：国家没填就默认 US
  useEffect(() => {
    if (controlled && !value?.country && !otherMode) onChange!({ ...value, country: "US" });
  }, [controlled, value, onChange, otherMode]);

  // 非受控表单里也要跟着国家切换州的输入方式
  const [uncCountry, setUncCountry] = useState((value?.country || "US").toUpperCase());
  const country = (controlled ? value?.country || (otherMode ? "" : "US") : uncCountry).toUpperCase();
  const isUS = country === "US";
  const set = (k: keyof Address, v: string) => onChange?.({ ...value, [k]: v });

  const input = (f: Field) => {
    const v = value?.[f.k] ?? "";
    const max = f.wide ? 100 : 50;
    return controlled ? (
      <input value={v} placeholder={f.ph} maxLength={max} onChange={(e) => set(f.k, e.target.value)} />
    ) : (
      <input name={namePrefix + f.k} defaultValue={v} placeholder={f.ph} maxLength={max} />
    );
  };

  const countryField = () => {
    const custom = otherMode || !COMMON_CODES.has(country);
    const hint = country && !isCountryCode(country) ? t("“{code}”不是有效的国家代码", { code: country }) : null;
    const onPick = (v: string) => {
      setOtherMode(v === "__other");
      if (controlled) set("country", v === "__other" ? "" : v);
      else setUncCountry(v === "__other" ? "" : v);
    };
    return (
      <>
        <select
          value={custom ? "__other" : country}
          name={controlled || custom ? undefined : namePrefix + "country"}
          onChange={(e) => onPick(e.target.value)}
        >
          {COMMON_COUNTRIES.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}
          <option value="__other">{t("其他国家（输入二字码）…")}</option>
        </select>
        {custom && (
          controlled ? (
            <input value={value?.country ?? ""} maxLength={2} placeholder={t("例如 SG")} style={{ marginTop: 6 }}
              onChange={(e) => set("country", e.target.value.toUpperCase())} />
          ) : (
            <input name={namePrefix + "country"} defaultValue={country} maxLength={2} placeholder={t("例如 SG")} style={{ marginTop: 6 }}
              onChange={(e) => setUncCountry(e.target.value.toUpperCase())} />
          )
        )}
        {hint && <span className="field-hint">{hint}</span>}
      </>
    );
  };

  const stateField = () => {
    const raw = value?.province ?? "";
    if (!isUS) return input({ k: "province", label: "" });
    const code = usStateCode(raw);
    const unknown = raw && !code;
    return (
      <>
        {controlled ? (
          <select value={code ?? ""} onChange={(e) => set("province", e.target.value)}>
            <option value="">{unknown ? t("（无法识别：{raw}）请选择", { raw }) : t("请选择州")}</option>
            {US_STATES.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}
          </select>
        ) : (
          <select name={namePrefix + "province"} defaultValue={code ?? ""}>
            <option value="">{t("请选择州")}</option>
            {US_STATES.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}
          </select>
        )}
        {unknown && <span className="field-hint">{t("“{raw}”不是美国的州，请从下拉框选择", { raw })}</span>}
      </>
    );
  };

  const zipHint = controlled && isUS && value?.zipCode && !isUsZip(value.zipCode) ? t("美国邮编是 5 位数字（可以带 4 位，例如 78701-1234）") : null;

  return (
    <>
      {controlled && <SmartPaste onParsed={(p) => onChange!({ ...value, ...p, country: p.country || value?.country || "US" })} />}
      <div className="grid">
        {FIELDS.map((f) => (
          <label key={f.k} className="f" style={f.wide ? { gridColumn: "span 2" } : undefined}>
            <span className={f.req && (f.k !== "province" || isUS) ? "req" : ""}>{t(f.label)}</span>
            {f.k === "country" ? countryField() : f.k === "province" ? stateField() : input(f)}
            {f.k === "zipCode" && zipHint && <span className="field-hint">{zipHint}</span>}
          </label>
        ))}
      </div>
    </>
  );
}

/** 智能识别：粘贴一段复制来的地址，自动拆到各个字段 */
function SmartPaste({ onParsed }: { onParsed: (a: Partial<Address>) => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const run = (t: string) => {
    const p = parseAddress(t);
    const n = Object.keys(p).length;
    if (!n) return setMsg(t("没有识别出地址，请检查粘贴的内容"));
    onParsed(p);
    const missing = (["nameFirst", "address1", "city", "province", "zipCode"] as const).filter((k) => !p[k]);
    setMsg(missing.length ? t("已识别 {n} 项，请补充：{list}", { n, list: missing.map((k) => t({ nameFirst: "姓名", address1: "地址", city: "城市", province: "州", zipCode: "邮编" }[k])).join(t("、")) }) : t("已识别 {n} 项，请核对一下", { n }));
  };
  return (
    <div className="smart-paste">
      <textarea
        rows={2}
        value={text}
        placeholder={t("智能识别：把复制的整段地址粘贴到这里，例如\nJohn Doe, 500 Congress Ave, Austin, TX 78701, 512-555-0100")}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          // 粘贴后自动识别
          const t = e.clipboardData.getData("text");
          if (t) setTimeout(() => run(t), 0);
        }}
      />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="small muted">{msg ?? t("粘贴后自动识别姓名、电话、邮箱、地址、城市、州、邮编")}</span>
        <div className="row">
          {text && <button type="button" className="small" onClick={() => { setText(""); setMsg(null); }}>{t("清空")}</button>}
          <button type="button" className="small" disabled={!text.trim()} onClick={() => run(text)}>{t("识别")}</button>
        </div>
      </div>
    </div>
  );
}
