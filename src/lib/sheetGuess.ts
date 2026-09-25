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

/** 用来给补差原因补充说明的列：结算重量、预报重量、分区 */
export function detailColumns(header: string[]) {
  const idx = (re: RegExp) => header.findIndex((h) => re.test(h ?? ""));
  return {
    billedWeight: idx(/结算重量\s*\(?lb\)?/i) >= 0 ? idx(/结算重量\s*\(?lb\)?/i) : idx(/结算重量|billed.?weight/i),
    declaredWeight: idx(/预报重量|declared.?weight/i),
    declaredZone: idx(/预报分区/),
    actualZone: idx(/^zone区$|实际分区|^zone$/i),
  };
}

function zoneNum(v: string | undefined) {
  return (v ?? "").replace(/\D/g, "");
}

/** 生成补差说明，例如“重量调整 · 结算重量(lb) 2.046 / 预报重量(oz) 25 · 分区 zone4” */
export function describeRow(header: string[], row: string[], reasonCol: number): string {
  const d = detailColumns(header);
  const parts: string[] = [];
  if (reasonCol >= 0 && row[reasonCol]) parts.push(row[reasonCol]);
  const w: string[] = [];
  if (d.billedWeight >= 0 && row[d.billedWeight]) w.push(`${header[d.billedWeight]} ${row[d.billedWeight]}`);
  if (d.declaredWeight >= 0 && row[d.declaredWeight]) w.push(`${header[d.declaredWeight]} ${row[d.declaredWeight]}`);
  if (w.length) parts.push(w.join(" / "));
  const dz = d.declaredZone >= 0 ? row[d.declaredZone] : "";
  const az = d.actualZone >= 0 ? row[d.actualZone] : "";
  if (dz && az && zoneNum(dz) !== zoneNum(az)) parts.push(`分区 ${dz} → zone${zoneNum(az)}`);
  else if (az || dz) parts.push(`分区 zone${zoneNum(az || dz)}`);
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
