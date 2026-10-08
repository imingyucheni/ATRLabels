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
  /** 收额外处理费（AHS）的箱子计费重最低按这个数（磅） */
  ahsMinBillLb: number;
  /** 收超尺寸附加费（Oversize）的箱子计费重最低按这个数（磅） */
  oversizeMinBillLb: number;
  /** 只发美国本土 48 州（不含阿拉斯加、夏威夷、波多黎各、关岛等海外地区和军邮） */
  contiguousOnly: boolean;
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
    ahsMinBillLb: 40,
    oversizeMinBillLb: 90,
    contiguousOnly: false,
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
    // 按嘉谷 FedEx MWT 结算价格表：200–500 lb / 500 lb 以上两档按每 100 lb 计价，最低收费 83.13；DIM 225
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
    ahsMinBillLb: 40,
    oversizeMinBillLb: 90,
    contiguousOnly: true,
    hsMinDigits: 0,
    notes: [
      "一票总重量 200 lb 起（200–500 lb、500 lb 以上两档，按每 100 lb 计价，最低收费 $83.13），至少 2 箱，同一天寄同一个地址",
      "体积重 = 长×宽×高 ÷ 225（英寸），每箱取实重和体积重中较大的；每箱平均不足 25 lb 按 25 lb 计",
      "单箱超过 50 lb，或最长边 > 48 in、次长边 > 30 in、长 + 2×宽 + 2×高 > 105 in，要另收额外处理费（AHS），这箱最低按 40 lb 计费",
      "超尺寸（Oversize：长 + 2×宽 + 2×高 > 130 in、最长边 > 96 in 或实重 > 110 lb）另收超尺寸费，最低按 90 lb 计费",
      "单箱计费重超过 150 lb、最长边超过 108 in、长 + 2×宽 + 2×高超过 165 in 的不能发",
      "只发美国本土 48 州（不含阿拉斯加、夏威夷、波多黎各等）",
      "运费不含燃油附加费，以及住宅、偏远地区、旺季等附加费（多箱有收费上限），以 FedEx 实际账单为准",
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

/** 一箱的计费重：实重和体积重中较大的（进位取整）；收 AHS / 超尺寸的箱子有最低计费重 */
export function boxBillLb(b: Omit<Piece, "qty">, rule?: Partial<Pick<MultiBoxRule, "dimDivisor" | "ahsMinBillLb" | "oversizeMinBillLb">> | null) {
  let w = Math.max(Math.ceil(b.weight), Math.ceil((b.length * b.width * b.height) / (rule?.dimDivisor ?? 250)));
  if (rule?.oversizeMinBillLb && oversizeReason(b)) w = Math.max(w, rule.oversizeMinBillLb);
  else if (rule?.ahsMinBillLb && ahsReason(b)) w = Math.max(w, rule.ahsMinBillLb);
  return w;
}

/** 箱数、实重、体积重、预计计费重（每箱计费重相加；平均不足最低平均重按最低算） */
export function summarizePieces(pieces: Piece[], rule?: Partial<Pick<MultiBoxRule, "dimDivisor" | "minAvgLb" | "ahsMinBillLb" | "oversizeMinBillLb">> | null) {
  const boxes = expandPieces(pieces);
  const actual = r2(boxes.reduce((a, b) => a + b.weight, 0));
  const divisor = rule?.dimDivisor ?? 250;
  const dim = boxes.reduce((a, b) => a + Math.ceil((b.length * b.width * b.height) / divisor), 0);
  let billable = boxes.reduce((a, b) => a + boxBillLb(b, rule), 0);
  if (rule?.minAvgLb) billable = Math.max(billable, rule.minAvgLb * boxes.length);
  return { boxes: boxes.length, actual, dim, billable };
}

const sorted = (b: Omit<Piece, "qty">) => [b.length, b.width, b.height].sort((x, y) => y - x);
const girth = (b: Omit<Piece, "qty">) => { const [l, w, h] = sorted(b); return l + 2 * w + 2 * h; };

/** 超尺寸（Oversize）：长 + 2×宽 + 2×高 > 130 in、最长边 > 96 in、体积 > 17,280 立方英寸或实重 > 110 lb */
export function oversizeReason(b: Omit<Piece, "qty">): string | null {
  const [l, w, h] = sorted(b);
  if (girth(b) > 130) return `长 + 2×宽 + 2×高 = ${r2(girth(b))} in 超过 130 in`;
  if (l > 96) return `最长边 ${l} in 超过 96 in`;
  if (l * w * h > 17280) return `体积 ${Math.round(l * w * h)} 立方英寸超过 17,280`;
  if (b.weight > 110) return `单箱 ${b.weight} lb 超过 110 lb`;
  return null;
}

/** 超出承运商最大限制（Unauthorized，罚款很高）：计费重 > 150 lb、最长边 > 108 in、长 + 2×宽 + 2×高 > 165 in */
export function unauthorizedReason(b: Omit<Piece, "qty">, dimDivisor: number): string | null {
  const [l] = sorted(b);
  const bill = Math.max(Math.ceil(b.weight), Math.ceil((b.length * b.width * b.height) / dimDivisor));
  if (bill > 150) return `计费重 ${bill} lb 超过 150 lb`;
  if (l > 108) return `最长边 ${l} in 超过 108 in`;
  if (girth(b) > 165) return `长 + 2×宽 + 2×高 = ${r2(girth(b))} in 超过 165 in`;
  return null;
}

/** 美国本土 48 州以外（阿拉斯加、夏威夷、海外地区、军邮） */
const NON_CONTIGUOUS = new Set(["AK", "HI", "PR", "VI", "GU", "AS", "MP", "AA", "AE", "AP", "FM", "MH", "PW"]);

/** 一箱会不会触发额外处理费（AHS）/ 超尺寸：返回原因，没有返回 null */
export function ahsReason(b: Omit<Piece, "qty">): string | null {
  const [l, w, h] = sorted(b);
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
  opts: { forOrder?: boolean; state?: string | null } = {},
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
  if (rule.contiguousOnly && opts.state && NON_CONTIGUOUS.has(opts.state.trim().toUpperCase())) {
    errs.push(`${rule.label} 只发美国本土 48 州，不能寄到 ${opts.state.trim().toUpperCase()}`);
  }
  // 允许 AHS 的渠道（FedEx MWT）：超出承运商最大限制的箱子不能发（会被罚 $1,875 / 箱）
  for (const p of rule.noAhs ? [] : pieces) {
    const why = unauthorizedReason(p, rule.dimDivisor);
    if (why) {
      errs.push(`${p.length}×${p.width}×${p.height} in 的箱子超出 ${rule.label} 的最大限制（${why}），不能发`);
      break;
    }
  }
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

/**
 * 不拦下单、但会多收钱的情况（允许 AHS / 超尺寸的渠道，例如 FedEx MWT）：下单页和报价上提醒。
 */
export function multiBoxWarnings(rule: MultiBoxRule, pieces: Piece[]): string[] {
  if (rule.noAhs) return [];
  const out: string[] = [];
  const over = pieces.filter((p) => oversizeReason(p) && !unauthorizedReason(p, rule.dimDivisor));
  const ahs = pieces.filter((p) => !oversizeReason(p) && ahsReason(p) && !unauthorizedReason(p, rule.dimDivisor));
  const n = (list: Piece[]) => list.reduce((a, p) => a + Math.max(0, Math.floor(p.qty)), 0);
  if (ahs.length) out.push(`${n(ahs)} 箱会另收额外处理费（AHS，${ahsReason(ahs[0])}），每箱计费重最低按 ${rule.ahsMinBillLb} lb`);
  if (over.length) out.push(`${n(over)} 箱会另收超尺寸费（Oversize，${oversizeReason(over[0])}），每箱计费重最低按 ${rule.oversizeMinBillLb} lb`);
  return out;
}
