/**
 * 服务商报价表（成本价）：在后台“派送范围”上传报价表时一起导入。
 * 只用于模拟模式：模拟报价按 “重量 + 分区” 查这张表得到成本，客户价在它上面按加价规则计算。
 * 正式模式的成本以 ShipBest 接口返回的价格为准。
 */
import { db } from "./db";
import type { ShipmentRequest } from "./shipbest/types";

export interface RateRow {
  maxOz: number;
  prices: Record<number, number>; // 分区 → 价格
}

function ensure() {
  const conn = db();
  conn.exec(`CREATE TABLE IF NOT EXISTS channel_rate_rules (
    channel_code TEXT PRIMARY KEY,
    divisor REAL NOT NULL,
    min_cubic REAL NOT NULL DEFAULT 0
  )`);
  conn.exec(`CREATE TABLE IF NOT EXISTS channel_rates (
    channel_code TEXT NOT NULL,
    max_oz REAL NOT NULL,
    zone INTEGER NOT NULL,
    price REAL NOT NULL,
    PRIMARY KEY (channel_code, max_oz, zone)
  ) WITHOUT ROWID`);
  return conn;
}

const ZONE = /^zone\s*(\d{1,2})$/i;
const num = (v: string) => {
  const n = parseFloat(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/** 识别一行的重量（换算成 oz）。unitHint：表头写的单位 */
function rowWeightOz(cells: string[], unitHint: "oz" | "lb" | null, weightCol: number): number | null {
  // 1) 重量列本身带单位：“1 oz”“15.99oz”“1 lbs”“1LB”
  const own = String(cells[weightCol] ?? "").trim();
  const m = own.match(/^(\d+(?:\.\d+)?)\s*(oz|ozs|lb|lbs|磅)?\.?\s*(以上)?$/i);
  if (m) {
    const n = parseFloat(m[1]);
    const u = m[2] ? (/oz/i.test(m[2]) ? "oz" : "lb") : unitHint;
    if (u) return u === "oz" ? n : n * 16;
  }
  // 2) 单位在旁边单独一列（SPX：1 | oz | 28g）
  for (let i = 0; i < cells.length - 1; i++) {
    const u = String(cells[i + 1] ?? "").trim().toLowerCase();
    if ((u === "oz" || u === "lb" || u === "lbs") && Number.isFinite(num(cells[i]))) return u === "oz" ? num(cells[i]) : num(cells[i]) * 16;
  }
  return null;
}

/**
 * 从一张工作表里读出价格表：找“Zone 1 / Zone 2 …”表头，读下面每行 “重量 → 各分区价格”。
 * 同一行有多组分区（例如 UniUni 无索赔 / 有索赔、SPX 各口岸）时只取第一组。
 */
export function extractRates(rows: string[][]): RateRow[] {
  const out = new Map<number, Record<number, number>>();
  for (let h = 0; h < rows.length; h++) {
    const head = rows[h].map((c) => String(c ?? "").trim());
    const first = head.findIndex((c) => ZONE.test(c));
    if (first < 0) continue;
    // 第一组连续的分区列（遇到非分区或重复的分区号就停）
    const zones: { col: number; zone: number }[] = [];
    for (let c = first; c < head.length; c++) {
      const m = head[c].match(ZONE);
      if (!m || zones.some((z) => z.zone === Number(m[1]))) break;
      zones.push({ col: c, zone: Number(m[1]) });
    }
    if (zones.length < 3) continue;
    // 重量列：分区左边最靠右的“oz / lb / 重量”列；没有就看行里的单位
    let weightCol = 0;
    let unitHint: "oz" | "lb" | null = null;
    for (let c = first - 1; c >= 0; c--) {
      const t = head[c].toLowerCase();
      if (/^(oz|ozs|ounces?)\.?$/.test(t)) { weightCol = c; unitHint = "oz"; break; }
      if (/^(lb|lbs|pounds?)\.?$/.test(t)) { weightCol = c; unitHint = "lb"; break; }
      if (/rate category|weight|重量/.test(t) && !/g$/.test(t)) { weightCol = c; break; }
    }
    let got = 0;
    for (let r = h + 1; r < rows.length; r++) {
      const cells = rows[r].map((c) => String(c ?? "").trim());
      if (cells.some((c) => ZONE.test(c))) break; // 下一段表头
      const oz = rowWeightOz(cells.slice(0, first), unitHint, weightCol);
      const prices: Record<number, number> = {};
      for (const z of zones) {
        const p = num(cells[z.col]);
        if (Number.isFinite(p) && p > 0) prices[z.zone] = p;
      }
      if (oz === null || !Object.keys(prices).length) {
        if (got) break; // 这一段表格结束
        continue;
      }
      const key = Math.round(oz * 1000) / 1000;
      out.set(key, { ...(out.get(key) ?? {}), ...prices });
      got++;
    }
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([maxOz, prices]) => ({ maxOz, prices }));
}

export function importRates(code: string, rows: RateRow[]) {
  const conn = ensure();
  conn.transaction(() => {
    conn.prepare("DELETE FROM channel_rates WHERE channel_code = ?").run(code);
    const ins = conn.prepare("INSERT OR REPLACE INTO channel_rates (channel_code, max_oz, zone, price) VALUES (?,?,?,?)");
    for (const r of rows) for (const [z, p] of Object.entries(r.prices)) ins.run(code, r.maxOz, Number(z), p);
  })();
}

export function rateStats(): Record<string, { rows: number; maxOz: number }> {
  const rows = ensure().prepare("SELECT channel_code, COUNT(DISTINCT max_oz) AS n, MAX(max_oz) AS m FROM channel_rates GROUP BY channel_code").all() as { channel_code: string; n: number; m: number }[];
  return Object.fromEntries(rows.map((r) => [r.channel_code, { rows: r.n, maxOz: r.m }]));
}

export function removeRates(code: string) {
  ensure().prepare("DELETE FROM channel_rates WHERE channel_code = ?").run(code);
}

/* ---------------- 体积重 ---------------- */

export interface DimRule {
  /** 体积重系数（立方英寸 ÷ 系数 = 磅）；0 = 不算体积重 */
  divisor: number;
  /** 体积超过多少立方英寸才算体积重（USPS 是 1728，即 1 立方英尺） */
  minCubic: number;
}

/** 默认规则（按渠道名称猜）：可以在后台“派送范围与价格表”里改 */
export function defaultDimRule(name: string): DimRule {
  if (/USPS/i.test(name)) return { divisor: 166, minCubic: 1728 };
  if (/GOFO|SWIFTX/i.test(name)) return { divisor: 139, minCubic: 0 };
  return { divisor: 166, minCubic: 0 };
}

export function dimRule(code: string, name = ""): DimRule {
  const r = ensure().prepare("SELECT divisor, min_cubic FROM channel_rate_rules WHERE channel_code = ?").get(code) as { divisor: number; min_cubic: number } | undefined;
  return r ? { divisor: r.divisor, minCubic: r.min_cubic } : defaultDimRule(name);
}

export function saveDimRule(code: string, rule: DimRule) {
  ensure()
    .prepare("INSERT INTO channel_rate_rules (channel_code, divisor, min_cubic) VALUES (?,?,?) ON CONFLICT(channel_code) DO UPDATE SET divisor = excluded.divisor, min_cubic = excluded.min_cubic")
    .run(code, Math.max(0, rule.divisor), Math.max(0, rule.minCubic));
}

/** 包裹体积（立方英寸） */
export function cubicInches(req: ShipmentRequest): number {
  const { length, width, height, displayUnitSystem: u } = req.pkg;
  const k = u === 3 ? 1 : 1 / 2.54; // cm → in
  return (Number(length) || 0) * k * ((Number(width) || 0) * k) * ((Number(height) || 0) * k);
}

/** 计费重量（oz）：实重和体积重取大；体积重按磅向上取整 */
export function billableOz(req: ShipmentRequest, rule: DimRule): { oz: number; dimLb: number | null } {
  const actual = weightOz(req);
  const cubic = cubicInches(req);
  if (!rule.divisor || cubic <= rule.minCubic) return { oz: actual, dimLb: null };
  const dimLb = Math.ceil(cubic / rule.divisor - 1e-9);
  return { oz: Math.max(actual, dimLb * 16), dimLb };
}

/** 包裹重量换算成 oz */
export function weightOz(req: ShipmentRequest): number {
  const w = Number(req.pkg.weight) || 0;
  const u = req.pkg.displayUnitSystem;
  return u === 1 ? w / 28.3495 : u === 2 ? w * 35.274 : w * 16;
}

/** 从 91710（洛杉矶）发货的大致分区：没有上传邮编分区表时用 */
function roughZone(zip: string): number {
  const d = Number(zip?.[0]);
  const z3 = Number(zip?.slice(0, 3));
  if (z3 >= 900 && z3 <= 935) return z3 <= 918 ? 1 : 2;
  if (z3 >= 936 && z3 <= 961) return 4;
  if (d === 8) return z3 >= 850 && z3 <= 865 ? 4 : z3 >= 889 && z3 <= 898 ? 3 : 5;
  if (d === 9) return z3 >= 967 && z3 <= 968 ? 8 : z3 >= 995 ? 8 : 5; // 夏威夷 / 阿拉斯加 / 西北
  return ({ 7: 6, 6: 7, 5: 7, 4: 7, 3: 8, 2: 8, 1: 8, 0: 8 } as Record<number, number>)[d] ?? 8;
}

/** 分区：优先用这个渠道邮编表里的分区，其次用任意渠道同一邮编的分区，最后估算 */
export function zoneFor(code: string, zip: string): number {
  const z = String(zip ?? "").match(/\d{5}/)?.[0];
  if (!z) return 8;
  const conn = db();
  try {
    const own = conn.prepare("SELECT zone FROM channel_zips WHERE channel_code = ? AND zip = ?").get(code, z) as { zone: string | null } | undefined;
    const n = Number(own?.zone);
    if (n >= 1 && n <= 12) return n;
    const any = conn.prepare("SELECT zone FROM channel_zips WHERE zip = ? AND zone GLOB '[0-9]*' LIMIT 1").get(z) as { zone: string } | undefined;
    const m = Number(any?.zone);
    if (m >= 1 && m <= 12) return m;
  } catch {
    // 还没有邮编表
  }
  return roughZone(z);
}

/** 模拟报价：按报价表算成本；这个渠道没有导入报价表时返回 null */
export function rateQuote(code: string, req: ShipmentRequest, name = ""): { price: number; zone: number; billableOz: number } | null {
  const conn = ensure();
  const oz = Math.max(billableOz(req, dimRule(code, name)).oz, 0.01);
  const zone = zoneFor(code, req.recipient?.zipCode ?? "");
  // 找第一个 ≥ 包裹重量的重量档；超过最大档用最大档
  const tier = (conn.prepare("SELECT max_oz FROM channel_rates WHERE channel_code = ? AND max_oz >= ? ORDER BY max_oz LIMIT 1").get(code, oz - 1e-9) as { max_oz: number } | undefined)
    ?? (conn.prepare("SELECT MAX(max_oz) AS max_oz FROM channel_rates WHERE channel_code = ?").get(code) as { max_oz: number | null } | undefined);
  if (!tier?.max_oz) return null;
  const rows = conn.prepare("SELECT zone, price FROM channel_rates WHERE channel_code = ? AND max_oz = ?").all(code, tier.max_oz) as { zone: number; price: number }[];
  if (!rows.length) return null;
  // 没有这个分区的价格时用最接近的更高分区（再没有就用最高分区）
  const hit = rows.find((r) => r.zone === zone) ?? rows.filter((r) => r.zone > zone).sort((a, b) => a.zone - b.zone)[0] ?? rows.sort((a, b) => b.zone - a.zone)[0];
  return { price: hit.price, zone: hit.zone, billableOz: oz };
}
