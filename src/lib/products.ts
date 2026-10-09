/**
 * 常用产品：客户把常发的产品存起来（SKU、品名、申报价、海关编码…，加上一个包裹装几件、包裹的尺寸和重量），
 * 下单时选一下就把商品明细和包裹尺寸重量都填好。店铺订单导入时，单个产品的订单也按这里的尺寸重量带出。
 */
import { db } from "./db";
import { isDimUnit, isWeightUnit, toSystem, unitsOf, type DimUnit, type WeightUnit } from "./units";
import { DEFAULT_ITEM_SKU } from "./sanitize";
import { skuComboKey, type RecentPackage } from "./portal";
import type { ShipmentRequest } from "./shipbest/types";

export interface SavedProduct {
  id: number;
  /** 显示名称（没填时用 SKU / 品名） */
  name: string;
  sku: string;
  productNameCn: string;
  productNameEn: string;
  declaredUnitPrice: number;
  hsCode: string;
  productNature: string;
  material: string;
  originCountry: string;
  /** 一个包裹装几件 */
  quantity: number;
  length: number;
  width: number;
  height: number;
  /** 整个包裹的重量（含包装） */
  weight: number;
  dimUnit: DimUnit;
  weightUnit: WeightUnit;
}

export type ProductInput = Omit<SavedProduct, "id" | "name"> & { id?: number; name?: string };

export const MAX_PRODUCTS = 300;

function ensureTable() {
  const conn = db();
  conn.exec(`CREATE TABLE IF NOT EXISTS customer_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_customer_products ON customer_products(customer_id)`);
  return conn;
}

/** 产品显示名称：没填时用 “SKU · 品名” */
export function productLabel(p: Pick<SavedProduct, "sku" | "productNameEn" | "productNameCn"> & { name?: string }) {
  return (p.name ?? "").trim() || [p.sku, p.productNameEn || p.productNameCn].map((x) => (x ?? "").trim()).filter(Boolean).join(" · ") || "产品";
}

const num = (v: unknown, digits = 3) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10 ** digits) / 10 ** digits : 0;
};
const text = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** 整理客户填的内容；不对返回错误信息 */
export function cleanProduct(raw: Partial<ProductInput>): { product: Omit<SavedProduct, "id"> } | { error: string } {
  const p = {
    name: text(raw.name, 60),
    sku: text(raw.sku, 64),
    productNameCn: text(raw.productNameCn, 100),
    productNameEn: text(raw.productNameEn, 100),
    declaredUnitPrice: num(raw.declaredUnitPrice, 2),
    hsCode: text(raw.hsCode, 14).replace(/[^\d.]/g, ""),
    productNature: text(raw.productNature, 20) || "2,4",
    material: text(raw.material, 60),
    originCountry: text(raw.originCountry, 2).toUpperCase(),
    quantity: Math.max(1, Math.min(9999, Math.floor(Number(raw.quantity) || 1))),
    length: num(raw.length, 2),
    width: num(raw.width, 2),
    height: num(raw.height, 2),
    weight: num(raw.weight),
    dimUnit: isDimUnit(raw.dimUnit) ? raw.dimUnit : "in",
    weightUnit: isWeightUnit(raw.weightUnit) ? raw.weightUnit : "lb",
  };
  if (!p.sku && !p.productNameEn && !p.productNameCn && !p.name) return { error: "请填写 SKU 或品名" };
  if (!(p.length > 0 && p.width > 0 && p.height > 0 && p.weight > 0)) return { error: "请填写包裹的长、宽、高和重量" };
  return { product: { ...p, name: productLabel(p) } };
}

type Row = { id: number; name: string; data_json: string };
const fromRow = (r: Row): SavedProduct => ({ ...(JSON.parse(r.data_json) as Omit<SavedProduct, "id" | "name">), id: r.id, name: r.name });

export function listProducts(customerId: number): SavedProduct[] {
  const rows = ensureTable().prepare("SELECT id, name, data_json FROM customer_products WHERE customer_id = ? ORDER BY name COLLATE NOCASE, id").all(customerId) as Row[];
  return rows.map(fromRow);
}

/** 新增或修改，返回 id */
export function saveProduct(customerId: number, raw: Partial<ProductInput>): number {
  const c = cleanProduct(raw);
  if ("error" in c) throw new Error(c.error);
  const { name: label, ...data } = c.product;
  const conn = ensureTable();
  const id = Number(raw.id) || 0;
  if (id) {
    const all = listProducts(customerId);
    if (data.sku && all.some((x) => x.id !== id && x.sku.toUpperCase() === data.sku.toUpperCase())) throw new Error("这个 SKU 已经存在另一个常用产品里，同一个 SKU 只能存一个");
    // 没传名称（下单页“存为常用产品”）：保留原来起的名称
    const name = raw.name === undefined ? all.find((x) => x.id === id)?.name ?? label : label;
    const r = conn.prepare("UPDATE customer_products SET name = ?, data_json = ?, updated_at = datetime('now') WHERE id = ? AND customer_id = ?").run(name, JSON.stringify(data), id, customerId);
    if (!r.changes) throw new Error("产品不存在");
    return id;
  }
  const count = (conn.prepare("SELECT COUNT(*) AS n FROM customer_products WHERE customer_id = ?").get(customerId) as { n: number }).n;
  if (count >= MAX_PRODUCTS) throw new Error(`常用产品最多保存 ${MAX_PRODUCTS} 个`);
  // 同一个 SKU 已经存过：更新那一个，不重复存（下单页“存为常用产品”再存一次 = 更新尺寸重量）
  if (data.sku) {
    const same = listProducts(customerId).find((x) => x.sku.toUpperCase() === data.sku.toUpperCase());
    if (same) return saveProduct(customerId, { ...raw, id: same.id });
  }
  return Number(conn.prepare("INSERT INTO customer_products (customer_id, name, data_json) VALUES (?,?,?)").run(customerId, label, JSON.stringify(data)).lastInsertRowid);
}

export function deleteProduct(customerId: number, id: number) {
  ensureTable().prepare("DELETE FROM customer_products WHERE id = ? AND customer_id = ?").run(id, customerId);
}

/** 产品的包裹换算成服务商认的单位组合（英寸配磅；厘米配克或公斤） */
export function productPackage(p: SavedProduct): RecentPackage {
  const c = toSystem(p.dimUnit, p.weightUnit, p.weight);
  return { length: p.length, width: p.width, height: p.height, weight: c.weight, unit: c.system, count: 1 };
}

/** 常用产品按“SKU × 一个包裹装几件”认出订单（店铺订单导入时带出包裹尺寸重量） */
export function packagesFromProducts(customerId: number): Map<string, RecentPackage> {
  const m = new Map<string, RecentPackage>();
  for (const p of listProducts(customerId)) if (p.sku) m.set(skuComboKey([{ sku: p.sku, quantity: p.quantity }]), productPackage(p));
  return m;
}

/**
 * 批量导入：一单只有一个 SKU、是存过的常用产品时，没填的品名 / 申报价 / 海关编码等按产品补上；
 * 包裹尺寸重量没填、件数和产品“一个包裹装几件”一样时，按产品的包裹补上。
 */
export function fillFromProduct(req: ShipmentRequest, products: SavedProduct[]): boolean {
  if (req.skuList.length !== 1) return false;
  const s = req.skuList[0];
  const p = products.find((x) => x.sku && x.sku.toUpperCase() === (s.sku ?? "").trim().toUpperCase());
  if (!p) return false;
  req.skuList[0] = {
    ...s,
    productNameEn: s.productNameEn || p.productNameEn,
    productNameCn: s.productNameCn || p.productNameCn,
    declaredUnitPrice: s.declaredUnitPrice || p.declaredUnitPrice,
    hsCode: s.hsCode || p.hsCode,
    material: s.material || p.material || undefined,
    originCountry: s.originCountry || p.originCountry || undefined,
  };
  const pk = req.pkg;
  if (!(pk.length > 0 || pk.width > 0 || pk.height > 0 || pk.weight > 0) && (s.quantity || 1) === p.quantity) {
    const b = productPackage(p);
    req.pkg = { ...pk, length: b.length, width: b.width, height: b.height, weight: b.weight, displayUnitSystem: b.unit };
  }
  return true;
}

/**
 * 从最近的订单里找还没存的产品（一单只有一个 SKU、填了包裹尺寸重量的），在“常用产品”页一键添加。
 * 同一个 SKU 取最近一次的商品信息和包裹。
 */
export function productSuggestions(customerId: number, limit = 12): Omit<SavedProduct, "id">[] {
  const saved = new Set(listProducts(customerId).map((p) => p.sku.toUpperCase()));
  const rows = db()
    .prepare("SELECT sku_json, package_json FROM shipments WHERE customer_id = ? AND created_at >= datetime('now', '-180 days') ORDER BY id DESC LIMIT 2000")
    .all(customerId) as { sku_json: string; package_json: string }[];
  const out = new Map<string, Omit<SavedProduct, "id">>();
  for (const r of rows) {
    try {
      const skus = JSON.parse(r.sku_json) as ShipmentRequest["skuList"];
      if (skus.length !== 1) continue;
      const s = skus[0];
      const sku = (s.sku ?? "").trim();
      const key = sku.toUpperCase();
      if (!sku || key === "SAMPLE" || key === DEFAULT_ITEM_SKU || saved.has(key) || out.has(key)) continue;
      const pkg = JSON.parse(r.package_json) as ShipmentRequest["pkg"];
      if (!(pkg.length > 0 && pkg.width > 0 && pkg.height > 0 && pkg.weight > 0) || pkg.pieces?.length) continue;
      const u = unitsOf(pkg.displayUnitSystem);
      const p = {
        sku, productNameCn: s.productNameCn ?? "", productNameEn: s.productNameEn ?? "", declaredUnitPrice: Number(s.declaredUnitPrice) || 0, hsCode: s.hsCode ?? "",
        productNature: s.productNature || "2,4", material: s.material ?? "", originCountry: s.originCountry ?? "", quantity: Math.max(1, Number(s.quantity) || 1),
        length: pkg.length, width: pkg.width, height: pkg.height, weight: pkg.weight, dimUnit: u.dim, weightUnit: u.weight,
      };
      out.set(key, { ...p, name: productLabel(p) });
      if (out.size >= limit) break;
    } catch {
      // 旧数据格式不对：跳过
    }
  }
  return [...out.values()];
}
