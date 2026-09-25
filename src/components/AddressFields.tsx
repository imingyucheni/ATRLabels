"use client";

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
  );
}
