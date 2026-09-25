import { usStateCode } from "./geo";
import type { Address, ShipmentRequest, SkuItem, UnitSystem } from "./shipbest/types";

/** 表单/客户端输入的清洗工具（后台和客户端共用） */

export function str(v: unknown, max = 200): string {
  return (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v)).trim().slice(0, max);
}
export function n(v: unknown): number {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
}
export function optNum(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const x = parseFloat(s);
  return Number.isFinite(x) ? x : null;
}
export function unit(v: unknown): UnitSystem {
  const u = Number(v);
  return u === 1 || u === 2 || u === 3 ? u : 1;
}

export function cleanAddress(a: Partial<Address> | undefined): Address {
  const x = a ?? {};
  const out: Address = {
    nameFirst: str(x.nameFirst),
    nameLast: str(x.nameLast),
    country: str(x.country, 2).toUpperCase(),
    city: str(x.city),
    address1: str(x.address1),
    zipCode: str(x.zipCode),
  };
  for (const k of ["phone", "email", "corporateName", "taxIdValue", "province", "area", "street", "houseNumber", "address2"] as const) {
    const v = str(x[k]);
    if (v) out[k] = v;
  }
  // 美国地址：州统一成二字码（“California” / “ca” → “CA”）
  if (out.country === "US" && out.province) out.province = usStateCode(out.province) ?? out.province;
  return out;
}

/** 中文品名可以不填（英文客户）：没填时用英文品名补上，ShipBest 两个字段都要有值 */
export function fillProductNames<T extends Pick<SkuItem, "productNameCn" | "productNameEn">>(s: T): T {
  return s.productNameCn || !s.productNameEn ? s : { ...s, productNameCn: s.productNameEn };
}

/** 客户端传来的数据不可信：统一转换类型、去掉多余字段。 */
export function cleanRequest(raw: ShipmentRequest): ShipmentRequest {
  const p = raw?.pkg ?? ({} as ShipmentRequest["pkg"]);
  const sig = Number(p.signServiceType);
  return {
    sender: cleanAddress(raw?.sender),
    recipient: cleanAddress(raw?.recipient),
    pkg: {
      length: n(p.length),
      width: n(p.width),
      height: n(p.height),
      weight: n(p.weight),
      displayUnitSystem: unit(p.displayUnitSystem),
      signServiceType: (sig >= 0 && sig <= 3 ? sig : 0) as 0 | 1 | 2 | 3,
      insuranceService: Number(p.insuranceService) === 1 ? 1 : 0,
      insuranceFee: n(p.insuranceFee) || undefined,
      currency: str(p.currency, 3).toUpperCase() || "USD",
    },
    skuList: (Array.isArray(raw?.skuList) ? raw.skuList : []).slice(0, 50).map(
      (s: Partial<SkuItem>): SkuItem => fillProductNames({
        sku: str(s.sku, 100),
        productNameCn: str(s.productNameCn),
        productNameEn: str(s.productNameEn),
        quantity: Math.round(n(s.quantity)),
        declaredUnitPrice: n(s.declaredUnitPrice),
        declaredCurrency: str(s.declaredCurrency, 3).toUpperCase() || "USD",
        hsCode: str(s.hsCode, 20),
        productNature: str(s.productNature, 20),
        length: n(s.length),
        width: n(s.width),
        height: n(s.height),
        weight: n(s.weight),
        unit: unit(s.unit),
      }),
    ),
  };
}

