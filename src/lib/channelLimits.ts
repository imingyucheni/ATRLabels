/**
 * 渠道的重量 / 尺寸限制：报价前先检查，超出的包裹这个渠道直接不报价（免得出单后被服务商拒收或补收）。
 * - 可以在后台“设置 → 渠道重量 / 尺寸限制”里逐个渠道设置；没设置时用默认值（来自服务商的渠道说明）
 * - 计费重 = max(实重, 体积重)，体积重 = 长 × 宽 × 高（英寸）÷ 材积系数
 */
import { db, getChannel } from "./db";
import { isJiaguCode } from "./shipbest/jiagu";
import type { ShipmentRequest } from "./shipbest/types";

export interface ChannelLimits {
  /** 最大计费重（磅） */
  maxLb?: number | null;
  /** 最长边（英寸） */
  maxLongestIn?: number | null;
  /** 长 + 宽 + 高（英寸） */
  maxSumIn?: number | null;
  /** 长 + 周长 = 长 + 2 × (宽 + 高)（英寸） */
  maxGirthIn?: number | null;
  /** 材积系数（立方英寸 ÷ 系数 = 体积重磅数）；空 = 只看实重 */
  divisor?: number | null;
}

const CM = 1 / 2.54;

/**
 * 嘉谷的默认限制（嘉谷万邑 2026.9.24 渠道说明）：只写“最大限制”（超过就拒收），附加费不管（接口报价已经包含）。
 * GOFO：DIM 166，计费重 20 磅以内（说明写“限制 20 磅以内”；20–30 磅虽然能收但要加 $15 并按 20 磅补收，安全起见不报价），最长边 ≤ 90cm，三边和 ≤ 150cm；SwiftX：DIM 166，20 磅以内；
 * UniUni：DIM 166，单边 ≤ 50cm，三边和 ≤ 120cm。
 */
export function defaultLimits(code: string, name = getChannel(code)?.name ?? ""): ChannelLimits | null {
  if (!isJiaguCode(code)) return shipBestDefault(name);
  if (/GOFO/i.test(name)) return { maxLb: 20, maxLongestIn: round1(90 * CM), maxSumIn: round1(150 * CM), divisor: 166 };
  if (/SWIFT\s*X/i.test(name)) return { maxLb: 20, divisor: 166 };
  if (/UNI\s*UNI/i.test(name)) return { maxLongestIn: round1(50 * CM), maxSumIn: round1(120 * CM), divisor: 166 };
  return null;
}

/**
 * ShipBest 的默认限制（ShipBest 2026.8 报价表里各渠道的“重量 / 尺寸限制”，只取超过就拒收的上限）：
 * GOFO ≤ 20 lb、单边 ≤ 60cm、三边和 ≤ 150cm；SwiftX 单边 ≤ 60cm、三边和 ≤ 120cm；
 * USPS ≤ 70 lb、最长边 ≤ 30in、长 + 周长 ≤ 130in；UniUni ≤ 30 lb、最长边 ≤ 20in、三边和 ≤ 50in；
 * 燕文 ≤ 20 lb、60×50×40cm 以内；SpeedX 计费重 ≤ 25 lb、最长边 ≤ 24in；
 * FedEx Economy ≤ 70 lb、长 + 周长 ≤ 130in；FedEx / UPS 地面 ≤ 150 lb、最长边 ≤ 108in、长 + 周长 ≤ 165in。
 * 材积系数都按 166（cm 算法 ÷6000）；USPS 体积重只在超过 1 立方英尺时才算，这里只检查实重。
 */
function shipBestDefault(name: string): ChannelLimits | null {
  if (/GOFO/i.test(name)) return { maxLb: 20, maxLongestIn: round1(60 * CM), maxSumIn: round1(150 * CM), divisor: 166 };
  if (/SWIFT\s*X/i.test(name)) return { maxLongestIn: round1(60 * CM), maxSumIn: round1(120 * CM) };
  if (/UNI\s*UNI/i.test(name)) return { maxLb: 30, maxLongestIn: 20, maxSumIn: 50, divisor: 166 };
  if (/YWE|燕文/i.test(name)) return { maxLb: 20, maxLongestIn: round1(60 * CM), maxSumIn: round1(150 * CM), divisor: 166 };
  if (/SPEED\s*X|\bSPX\b/i.test(name)) return { maxLb: 25, maxLongestIn: 24, divisor: 166 };
  if (/USPS/i.test(name)) return { maxLb: 70, maxLongestIn: 30, maxGirthIn: 130 };
  if (/FEDEX.*(ECONOMY|SMART)/i.test(name)) return { maxLb: 70, maxGirthIn: 130 };
  if (/FEDEX|UPS/i.test(name)) return { maxLb: 150, maxLongestIn: 108, maxGirthIn: 165 };
  return null;
}

function round1(n: number) {
  return Math.floor(n * 10) / 10;
}

let ready: unknown = null;
function conn() {
  const c = db();
  if (ready !== c) {
    c.exec(`CREATE TABLE IF NOT EXISTS channel_limits (
      channel_code TEXT PRIMARY KEY,
      max_lb REAL, max_longest_in REAL, max_sum_in REAL, max_girth_in REAL, divisor REAL
    )`);
    ready = c;
  }
  return c;
}

type Row = { max_lb: number | null; max_longest_in: number | null; max_sum_in: number | null; max_girth_in: number | null; divisor: number | null };

/** 后台保存过的限制（没保存过 = null，用默认值） */
export function savedLimits(code: string): ChannelLimits | null {
  const r = conn().prepare("SELECT * FROM channel_limits WHERE channel_code = ?").get(code) as Row | undefined;
  return r ? { maxLb: r.max_lb, maxLongestIn: r.max_longest_in, maxSumIn: r.max_sum_in, maxGirthIn: r.max_girth_in, divisor: r.divisor } : null;
}

export function limitsFor(code: string): ChannelLimits | null {
  return savedLimits(code) ?? defaultLimits(code);
}

export function saveLimits(code: string, l: ChannelLimits | null) {
  if (!l) {
    conn().prepare("DELETE FROM channel_limits WHERE channel_code = ?").run(code);
    return;
  }
  conn()
    .prepare(
      `INSERT INTO channel_limits (channel_code, max_lb, max_longest_in, max_sum_in, max_girth_in, divisor) VALUES (?,?,?,?,?,?)
       ON CONFLICT(channel_code) DO UPDATE SET max_lb = excluded.max_lb, max_longest_in = excluded.max_longest_in, max_sum_in = excluded.max_sum_in, max_girth_in = excluded.max_girth_in, divisor = excluded.divisor`,
    )
    .run(code, l.maxLb ?? null, l.maxLongestIn ?? null, l.maxSumIn ?? null, l.maxGirthIn ?? null, l.divisor ?? null);
}

/** 包裹尺寸（英寸，从大到小）和实重（磅） */
export function packageInLb(req: ShipmentRequest) {
  const { length, width, height, weight, displayUnitSystem: u } = req.pkg;
  const k = u === 3 ? 1 : CM;
  const dims = [length, width, height].map((v) => (Number(v) || 0) * k).sort((a, b) => b - a);
  const w = Number(weight) || 0;
  const lb = u === 1 ? w / 453.592 : u === 2 ? w * 2.20462 : w;
  return { dims, lb };
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

/** 检查包裹是否超出渠道限制：超出返回原因（后台看得到具体数字，客户只看到“不支持该重量 / 尺寸”），没超出返回 null */
export function checkLimits(code: string, req: ShipmentRequest): string | null {
  const l = limitsFor(code);
  if (!l) return null;
  const { dims, lb } = packageInLb(req);
  const [a, b, c] = dims;
  if (l.maxLongestIn && a > l.maxLongestIn + 1e-6) return `超出渠道尺寸限制：最长边 ${f1(a)} in，上限 ${f1(l.maxLongestIn)} in`;
  if (l.maxSumIn && a + b + c > l.maxSumIn + 1e-6) return `超出渠道尺寸限制：长宽高之和 ${f1(a + b + c)} in，上限 ${f1(l.maxSumIn)} in`;
  if (l.maxGirthIn && a + 2 * (b + c) > l.maxGirthIn + 1e-6) return `超出渠道尺寸限制：长 + 周长 ${f1(a + 2 * (b + c))} in，上限 ${f1(l.maxGirthIn)} in`;
  if (l.maxLb) {
    const dimLb = l.divisor ? (a * b * c) / l.divisor : 0;
    const billed = Math.max(lb, dimLb);
    if (billed > l.maxLb + 1e-6)
      return `超出渠道重量限制：计费重量 ${f1(billed)} lb（实重 ${f1(lb)} lb${dimLb ? `，按材积系数 ${l.divisor} 折算 ${f1(dimLb)} lb` : ""}），上限 ${f1(l.maxLb)} lb`;
  }
  return null;
}
