/**
 * 补差表格的列识别（服务端和浏览器共用，不能引用 Node 模块）。
 * 以 ShipBest 实际给的 GOFO 补差表为准：
 * 客户 | 运单号 | 日期 | 客户单号 | … | 结算重量(lb) | 结算重量(oz) | 预报重量(oz) | 实重(LB) | … 各项费用 … |
 * 邮编分区 | 预报分区 | Zone区 | 运单状态 | 备注说明 | 应收金额 | 实收金额 | 补收金额
 * 补收金额 = 应收金额 - 实收金额，正数表示需要补扣。
 */

export interface GuessedColumns {
  keyCol: number;
  /** 备用单号列：主单号匹配不到时再用它（例如“客户单号”= 我们的自定义单号） */
  altKeyCol: number;
  amountCol: number;
  reasonCol: number;
}

function findFirst(header: string[], patterns: RegExp[], exclude: number[] = []): number {
  for (const re of patterns) {
    const i = header.findIndex((h, idx) => !exclude.includes(idx) && re.test(h ?? ""));
    if (i >= 0) return i;
  }
  return -1;
}

export function guessColumns(header: string[]): GuessedColumns {
  const keyCol = findFirst(header, [/^运单号$/, /运单号|跟踪号|追踪号|tracking/i, /运单|waybill|单号|order/i]);
  const altKeyCol = findFirst(header, [/客户单号|参考号|自定义单号|customer.?(no|ref)|reference/i], [keyCol]);
  const amountCol = findFirst(
    header,
    [
      /^补收金额$|^补差金额$/,
      /补收|补差|差额|多退少补|应补|补款|调整金额|补扣|adjust|diff/i,
      /金额|amount/i,
    ],
    [keyCol, altKeyCol],
  );
  const reasonCol = findFirst(header, [/备注说明|原因|reason/i, /备注|说明|remark|note/i]);
  return { keyCol, altKeyCol, amountCol, reasonCol };
}

/** 表头行识别：前 15 行里第一个同时含单号类和金额类列名的行 */
export function guessHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const g = guessColumns(rows[i]);
    if (rows[i].filter(Boolean).length >= 2 && g.keyCol >= 0 && g.amountCol >= 0) return i;
  }
  return 0;
}

type WeightUnit = "oz" | "lb" | "g" | "kg";

function unitOf(h: string): WeightUnit | null {
  const m = /\((oz|lb|g|kg)\)|（(oz|lb|g|kg)）|\b(oz|lb|lbs|kg|g)\b/i.exec(h ?? "");
  const u = (m?.[1] || m?.[2] || m?.[3] || "").toLowerCase();
  return u === "lbs" ? "lb" : (u as WeightUnit) || null;
}

const TO_OZ: Record<WeightUnit, number> = { oz: 1, lb: 16, g: 1 / 28.3495, kg: 35.274 };

function round(n: number, d = 2) {
  return Math.round(n * 10 ** d) / 10 ** d;
}

/** 用来给补差原因补充说明的列：结算重量、预报重量、实重、分区 */
export function detailColumns(header: string[]) {
  const all = (re: RegExp) => header.map((h, i) => (re.test(h ?? "") ? i : -1)).filter((i) => i >= 0);
  const declared = all(/预报重量|declared.?weight/i);
  const billedAll = all(/结算重量|计费重量|billed.?weight/i);
  const declaredIdx = declared[0] ?? -1;
  // 结算重量优先取和预报重量同单位的那一列，方便直接对比
  const du = declaredIdx >= 0 ? unitOf(header[declaredIdx]) : null;
  const billedIdx = billedAll.find((i) => du && unitOf(header[i]) === du) ?? billedAll[0] ?? -1;
  const idx = (re: RegExp) => header.findIndex((h) => re.test(h ?? ""));
  return {
    billedWeight: billedIdx,
    declaredWeight: declaredIdx,
    actualWeight: idx(/^实重|实际重量|actual.?weight/i),
    declaredZone: idx(/预报分区/),
    actualZone: idx(/^zone区$|实际分区|^zone$/i),
  };
}

export interface WeightDiff {
  declared: number;
  billed: number;
  /** 结算 - 预报，单位同 unit */
  diff: number;
  unit: WeightUnit;
}

/** 结算重量和预报重量的差（统一换算到预报重量的单位；缺单位时按同单位处理） */
export function weightDiff(header: string[], row: string[]): WeightDiff | null {
  const d = detailColumns(header);
  if (d.billedWeight < 0 || d.declaredWeight < 0) return null;
  const billedRaw = parseFloat(row[d.billedWeight] ?? "");
  const declared = parseFloat(row[d.declaredWeight] ?? "");
  if (!Number.isFinite(billedRaw) || !Number.isFinite(declared)) return null;
  const du = unitOf(header[d.declaredWeight]);
  const bu = unitOf(header[d.billedWeight]);
  const unit = du ?? bu ?? "oz";
  const billed = du && bu && du !== bu ? (billedRaw * TO_OZ[bu]) / TO_OZ[du] : billedRaw;
  return { declared: round(declared, 3), billed: round(billed, 2), diff: round(billed - declared, 2), unit };
}

function zoneNum(v: string | undefined) {
  return (v ?? "").replace(/\D/g, "");
}

/** 生成补差说明，例如“重量调整：预报 25 oz → 结算 32.74 oz（超出 7.74 oz）· 实重 1.036 lb · zone4” */
export function describeRow(header: string[], row: string[], reasonCol: number): string {
  const d = detailColumns(header);
  const reason = reasonCol >= 0 ? row[reasonCol] ?? "" : "";
  const parts: string[] = [];
  const w = weightDiff(header, row);
  if (w) {
    const trend = w.diff > 0 ? `超出 ${w.diff} ${w.unit}` : w.diff < 0 ? `少 ${-w.diff} ${w.unit}` : "无差异";
    parts.push(`${reason ? reason + "：" : ""}预报 ${w.declared} ${w.unit} → 结算 ${w.billed} ${w.unit}（${trend}）`);
  } else if (reason) {
    parts.push(reason);
  }
  // 实重为 0 表示没有测到，不显示
  if (d.actualWeight >= 0 && parseFloat(row[d.actualWeight] ?? "") > 0) {
    const u = unitOf(header[d.actualWeight]);
    parts.push(`实重 ${row[d.actualWeight]}${u ? " " + u : ""}`);
  }
  const dz = d.declaredZone >= 0 ? row[d.declaredZone] : "";
  const az = d.actualZone >= 0 ? row[d.actualZone] : "";
  if (dz && az && zoneNum(dz) !== zoneNum(az)) parts.push(`分区 ${dz} → zone${zoneNum(az)}`);
  else if (az || dz) parts.push(`zone${zoneNum(az || dz)}`);
  return parts.join(" · ");
}

/**
 * 导出给客户时可以保留的原始列（白名单）：日期、尺寸、重量、邮编、州、分区、状态、备注。
 * 金额、各项费用、应收/实收、我们在服务商那边的账户名等一律不导出。
 */
export function customerSafeColumns(header: string[], exclude: number[] = []): number[] {
  const allow = /日期|date|^长|^宽|^高|length|width|height|重量|实重|weight|邮编|zip|到件州|state|分区|zone|状态|status|备注|说明|remark|note/i;
  const deny = /金额|费|价|应收|实收|补收|退还|amount|fee|charge|cost|price|^客户$|customer$/i;
  return header.map((h, i) => i).filter((i) => !exclude.includes(i) && allow.test(header[i] ?? "") && !deny.test(header[i] ?? ""));
}
