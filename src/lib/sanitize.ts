import { usStateCode } from "./geo";
import type { Address, ShipmentRequest, SkuItem, UnitSystem } from "./shipbest/types";
import { pkgFromPieces } from "./multiBox";

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
/** 美国国内件没填商品时用的默认商品（不印到面单上） */
export const DEFAULT_ITEM_SKU = "GENERAL";
const US_DOMESTIC = new Set(["US", "PR", "VI", "GU", "AS", "MP", "UM"]);

/**
 * 美国国内件商品明细选填：完全空的行去掉；只填了一部分的补上默认值（SKU / 英文品名互相补、申报单价默认 1、商品性质默认普货）；
 * 一行都没有时用一件普通货物。国际件不处理（报关信息必须填）。
 */
function domesticItems(req: ShipmentRequest): ShipmentRequest {
  if (!US_DOMESTIC.has((req.recipient.country || "US").toUpperCase())) return req;
  const u = req.pkg.displayUnitSystem;
  const rows = req.skuList
    .filter((s) => s.sku || s.productNameEn || s.productNameCn || s.declaredUnitPrice > 0)
    .map((s) => fillProductNames({
      ...s,
      sku: s.sku || s.productNameEn || s.productNameCn || DEFAULT_ITEM_SKU,
      productNameEn: s.productNameEn || s.sku || "Merchandise",
      quantity: s.quantity > 0 ? s.quantity : 1,
      declaredUnitPrice: s.declaredUnitPrice > 0 ? s.declaredUnitPrice : 1,
      productNature: s.productNature || "2,4",
    }));
  if (rows.length) return { ...req, skuList: rows };
  const p = req.pkg;
  return {
    ...req,
    skuList: [{ sku: DEFAULT_ITEM_SKU, productNameCn: "普通货物", productNameEn: "Merchandise", quantity: 1, declaredUnitPrice: 1, declaredCurrency: "USD", hsCode: "", productNature: "2,4", length: p.length, width: p.width, height: p.height, weight: p.weight, unit: u }],
  };
}

export function cleanRequest(raw: ShipmentRequest): ShipmentRequest {
  const p = raw?.pkg ?? ({} as ShipmentRequest["pkg"]);
  const sig = Number(p.signServiceType);
  // 多箱寄出：箱规列表（英寸 / 磅），包裹字段换成汇总（最大那箱的尺寸 + 总重量）
  const pieces = Array.isArray(p.pieces)
    ? p.pieces.slice(0, 50).map((x) => ({ length: n(x?.length), width: n(x?.width), height: n(x?.height), weight: n(x?.weight), qty: Math.min(500, Math.max(0, Math.round(n(x?.qty)))) })).filter((x) => x.qty > 0)
    : null;
  if (pieces?.length) {
    const sum = pkgFromPieces(pieces);
    return domesticItems({
      sender: cleanAddress(raw?.sender),
      recipient: cleanAddress(raw?.recipient),
      pkg: { ...sum, displayUnitSystem: 3, signServiceType: (sig >= 0 && sig <= 3 ? sig : 0) as 0 | 1 | 2 | 3, insuranceService: 0, currency: "USD", pieces },
      skuList: cleanSkus(raw),
    });
  }
  return domesticItems({
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
    skuList: cleanSkus(raw),
  });
}

function cleanSkus(raw: ShipmentRequest): SkuItem[] {
  return (Array.isArray(raw?.skuList) ? raw.skuList : []).slice(0, 50).map(
      (s: Partial<SkuItem>): SkuItem => fillProductNames({
        sku: str(s.sku, 100),
        productNameCn: str(s.productNameCn),
        productNameEn: str(s.productNameEn),
        quantity: Math.round(n(s.quantity)),
        declaredUnitPrice: n(s.declaredUnitPrice),
        declaredCurrency: str(s.declaredCurrency, 3).toUpperCase() || "USD",
        hsCode: str(s.hsCode, 20),
        productNature: str(s.productNature, 20),
        ...(str(s.originCountry, 2) ? { originCountry: str(s.originCountry, 2).toUpperCase() } : {}),
        ...(str(s.material, 100) ? { material: str(s.material, 100) } : {}),
        length: n(s.length),
        width: n(s.width),
        height: n(s.height),
        weight: n(s.weight),
        unit: unit(s.unit),
      }),
    );
}

