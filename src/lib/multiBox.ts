/**
 * 多箱寄出（一票多箱寄同一个地址，按总重量计价）：UPS HWT、FedEx MWT 这类渠道。
 * 前后端共用（不能引用服务端模块）。尺寸、重量一律英寸 / 磅。
 */

export interface Piece {
  length: number;
  width: number;
  height: number;
  /** 单箱重量（磅） */
  weight: number;
  /** 这种箱规有几箱 */
  qty: number;
}

export interface MultiBoxRule {
  id: string;
  /** 渠道名里有这个就是这类多箱渠道 */
  match: RegExp;
  label: string;
  /** 一票总重量（磅）范围 */
  minTotalLb: number;
  maxTotalLb: number | null;
  /** 单箱最重（磅） */
  maxBoxLb: number;
  /** 至少几箱（“多订单一起下单”） */
  minBoxes: number;
  /** 材积系数：长×宽×高 ÷ 系数 = 体积重 */
  dimDivisor: number;
  /** 每箱平均计费重不足这个数按这个数算 */
  minAvgLb: number;
  /** 不能触发额外处理费（AHS）和超尺寸（Oversize） */
  noAhs: boolean;
  /** 海关编码至少几位（0 = 不要求） */
  hsMinDigits: number;
  /** 说明（下单页显示给客户） */
  notes: string[];
}

export const MULTI_BOX_RULES: MultiBoxRule[] = [
  {
    id: "ups-hwt",
    match: /\bHWT\b/i,
    label: "UPS HWT",
    // 按嘉谷结算价格表：200–2000 lb（不在区间按 Ground 公布价计费；更细的限制以接口返回为准）
    minTotalLb: 200,
    maxTotalLb: 2000,
    maxBoxLb: 50,
    minBoxes: 2,
    dimDivisor: 250,
    minAvgLb: 25,
    noAhs: true,
    hsMinDigits: 8,
    notes: [
      "一票总重量 200–2000 lb（含 UPS 审计后的重量），不在这个区间按 UPS Ground 公布价计费",
      "至少 2 箱一起下单，单箱不超过 50 lb",
      "不能有额外处理费（AHS）和超尺寸（Oversize）的箱子：最长边 ≤ 48 in、次长边 ≤ 30 in、长 + 2×宽 + 2×高 ≤ 105 in、体积 ≤ 10,368 立方英寸",
      "英文品名必填，不能有中文；海关编码（HS）至少 8 位",
      "取消要整票取消；申请取消的面单务必作废，不能再用，否则会丢件并按 Ground 公布价计费",
    ],
  },
  {
    id: "fedex-mwt",
    match: /\bMWT\b/i,
    label: "FedEx MWT",
    minTotalLb: 200,
    maxTotalLb: null,
    maxBoxLb: 150,
    minBoxes: 2,
    dimDivisor: 225,
    minAvgLb: 25,
    noAhs: false,
    hsMinDigits: 0,
    notes: [
      "一票总重量 200 lb 起，同一天寄同一个地址",
      "至少 2 箱一起下单，单箱不超过 150 lb；超过 50 lb 的箱子另收超重附加费",
      "每箱平均计费重不足 25 lb 按 25 lb 计",
    ],
  },
];

export function multiBoxRule(channelName: string | null | undefined): MultiBoxRule | null {
  return MULTI_BOX_RULES.find((r) => r.match.test(channelName ?? "")) ?? null;
}

export const isMultiBoxName = (name: string | null | undefined) => !!multiBoxRule(name);

/** 展开成一箱一行 */
export function expandPieces(pieces: Piece[]): Omit<Piece, "qty">[] {
  return pieces.flatMap((p) => Array.from({ length: Math.max(0, Math.floor(p.qty)) }, () => ({ length: p.length, width: p.width, height: p.height, weight: p.weight })));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** 箱数、实重、体积重、预计计费重（每箱取实重和体积重中较大的、进位取整；平均不足最低平均重按最低算） */
export function summarizePieces(pieces: Piece[], rule?: Pick<MultiBoxRule, "dimDivisor" | "minAvgLb"> | null) {
  const boxes = expandPieces(pieces);
  const actual = r2(boxes.reduce((a, b) => a + b.weight, 0));
  const divisor = rule?.dimDivisor ?? 250;
  const dim = boxes.reduce((a, b) => a + Math.ceil((b.length * b.width * b.height) / divisor), 0);
  let billable = boxes.reduce((a, b) => a + Math.max(Math.ceil(b.weight), Math.ceil((b.length * b.width * b.height) / divisor)), 0);
  if (rule?.minAvgLb) billable = Math.max(billable, rule.minAvgLb * boxes.length);
  return { boxes: boxes.length, actual, dim, billable };
}

/** 一箱会不会触发额外处理费（AHS）/ 超尺寸：返回原因，没有返回 null */
export function ahsReason(b: Omit<Piece, "qty">): string | null {
  const [l, w, h] = [b.length, b.width, b.height].sort((x, y) => y - x);
  if (l > 48) return `最长边 ${l} in 超过 48 in`;
  if (w > 30) return `次长边 ${w} in 超过 30 in`;
  if (l + 2 * w + 2 * h > 105) return `长 + 2×宽 + 2×高 = ${r2(l + 2 * w + 2 * h)} in 超过 105 in`;
  if (l * w * h > 10368) return `体积 ${Math.round(l * w * h)} 立方英寸超过 10,368`;
  if (b.weight > 50) return `单箱 ${b.weight} lb 超过 50 lb`;
  return null;
}

/** 包裹汇总：总重量 + 体积最大的那一箱的尺寸（单箱下单的字段、导出等沿用） */
export function pkgFromPieces(pieces: Piece[]) {
  const boxes = expandPieces(pieces);
  const big = [...boxes].sort((a, b) => b.length * b.width * b.height - a.length * a.width * a.height)[0] ?? { length: 0, width: 0, height: 0 };
  return { length: big.length, width: big.width, height: big.height, weight: r2(boxes.reduce((a, b) => a + b.weight, 0)) };
}

const CJK = /[㐀-鿿豈-﫿]/;

/**
 * 检查一票多箱货是否符合渠道要求。forOrder = 出单（还要检查品名、海关编码）。
 * 返回问题列表（空 = 没问题）。
 */
export function checkMultiBox(
  rule: MultiBoxRule,
  pieces: Piece[],
  items: { productNameEn?: string; hsCode?: string }[] = [],
  opts: { forOrder?: boolean } = {},
): string[] {
  const errs: string[] = [];
  const bad = pieces.filter((p) => !(p.length > 0 && p.width > 0 && p.height > 0 && p.weight > 0 && p.qty >= 1));
  if (bad.length || !pieces.length) {
    errs.push("每种箱规都要填长、宽、高、单箱重量和箱数");
    return errs;
  }
  const boxes = expandPieces(pieces);
  const s = summarizePieces(pieces, rule);
  if (boxes.length < rule.minBoxes) errs.push(`${rule.label} 至少 ${rule.minBoxes} 箱一起下单（现在 ${boxes.length} 箱）`);
  if (s.actual < rule.minTotalLb) errs.push(`${rule.label} 一票总重量至少 ${rule.minTotalLb} lb（现在 ${s.actual} lb）`);
  if (rule.maxTotalLb && s.actual > rule.maxTotalLb) errs.push(`${rule.label} 一票总重量最多 ${rule.maxTotalLb} lb（现在 ${s.actual} lb），请分成几票下单`);
  if (rule.maxTotalLb && s.billable > rule.maxTotalLb && s.actual <= rule.maxTotalLb) errs.push(`按体积算的计费重 ${s.billable} lb 超过 ${rule.maxTotalLb} lb，会按公布价计费，请分票或换小一点的箱子`);
  const heavy = pieces.find((p) => p.weight > rule.maxBoxLb);
  if (heavy) errs.push(`${rule.label} 单箱不能超过 ${rule.maxBoxLb} lb（有一种箱子 ${heavy.weight} lb）`);
  if (rule.noAhs) {
    for (const p of pieces) {
      const why = ahsReason(p);
      if (why && !(p.weight > rule.maxBoxLb)) {
        errs.push(`${p.length}×${p.width}×${p.height} in 的箱子会产生额外处理费 / 超尺寸（${why}），${rule.label} 不能发`);
        break;
      }
    }
  }
  if (opts.forOrder) {
    const list = items.length ? items : [{}];
    list.forEach((it, i) => {
      const n = list.length > 1 ? `商品 ${i + 1}：` : "";
      const en = (it.productNameEn ?? "").trim();
      if (!en) errs.push(`${n}英文品名必填`);
      else if (CJK.test(en)) errs.push(`${n}英文品名不能有中文`);
      if (rule.hsMinDigits) {
        const hs = (it.hsCode ?? "").replace(/\D/g, "");
        if (hs.length < rule.hsMinDigits) errs.push(`${n}海关编码（HS）至少 ${rule.hsMinDigits} 位数字`);
      }
    });
  }
  return errs;
}
