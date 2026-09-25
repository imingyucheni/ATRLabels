/**
 * 智能识别地址：把从订单后台、聊天记录里复制的一段地址拆成各个字段。
 * 支持常见的美国地址写法，例如：
 *   John Doe
 *   500 Congress Ave Apt 4
 *   Austin, TX 78701-1234
 *   United States
 *   Phone: +1 512-555-0100
 * 也支持一行逗号分隔、带“姓名：/电话：/地址：”标签的写法。识别不了的部分保持原样，请人工检查。
 */
import type { Address } from "./shipbest/types";

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
  guam: "GU", "virgin islands": "VI",
};
const CODES = new Set(Object.values(STATES).concat(["AA", "AE", "AP", "AS", "MP"]));
const STATE_NAMES = Object.keys(STATES).sort((a, b) => b.length - a.length).join("|");

const COUNTRY = /^(united states( of america)?|usa|u\.s\.a\.?|us|america|美国)$/i;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
// 电话：+1 (512) 555-0100 / 512.555.0100 / 5125550100 / 带分机
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:ext\.?|x|#)\s*\d{1,6})?/i;
const LABEL = /^\s*(ship\s*to|shipping\s*address|recipient|sender|name|full\s*name|contact|address(\s*line)?\s*\d?|addr|phone(\s*number)?|tel(ephone)?|mobile|email|e-mail|收件人|寄件人|联系人|姓名|名字|电话|手机|联系电话|地址|详细地址|邮箱|邮编|城市|州)\s*[:：]\s*/i;
const UNIT = /^(apt|apartment|suite|ste|unit|#|bldg|building|fl|floor|rm|room|dept|po box|p\.o\. box)\b\.?/i;
const STREET_HINT = /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|way|pl|place|pkwy|parkway|hwy|highway|cir|circle|ter|terrace|trl|trail|loop|sq|square)\b\.?/i;

// “City, ST 12345” / “City ST 12345-6789” / “City, Texas 12345” / “ST 12345”
const CITY_LINE = new RegExp(`^(?:(.*?)[,\\s]+)?(${STATE_NAMES}|[A-Za-z]{2})\\.?[,\\s]+(\\d{5}(?:-\\d{4})?)$`, "i");

function stateCode(s: string): string | null {
  const t = s.trim().toLowerCase();
  if (STATES[t]) return STATES[t];
  const up = t.toUpperCase();
  return CODES.has(up) ? up : null;
}

function splitName(full: string): Pick<Address, "nameFirst" | "nameLast"> {
  const parts = full.replace(/\s+/g, " ").trim().split(" ");
  if (parts.length === 1) return { nameFirst: parts[0], nameLast: parts[0] };
  return { nameFirst: parts.slice(0, -1).join(" "), nameLast: parts[parts.length - 1] };
}

export function parseAddress(text: string): Partial<Address> {
  const out: Partial<Address> = {};
  let raw = (text ?? "").replace(/\r/g, "").replace(/\t/g, " ").trim();
  if (!raw) return out;

  // 1) 邮箱、电话（可能在任意位置，先取出来）
  const email = raw.match(EMAIL)?.[0];
  if (email) {
    out.email = email;
    raw = raw.replace(email, " ");
  }

  // 2) 分行，每行再按逗号 / 分号拆开（城市、州、邮编后面会重新拼起来识别）
  let lines = raw
    .split(/\n+/)
    .map((l) => l.replace(LABEL, ""))
    .flatMap((l) => l.split(/[,;，；]\s*/))
    .map((l) => l.replace(LABEL, "").trim())
    .filter(Boolean);

  // 电话：单独一行，或行尾带的电话（不能把邮编 / 门牌号当电话）
  lines = lines
    .map((l) => {
      if (out.phone) return l;
      const m = l.match(PHONE);
      if (m && m[0].replace(/\D/g, "").length >= 10 && !/^\d{5}(-\d{4})?$/.test(l)) {
        const rest = l.replace(m[0], "").replace(/^(phone|tel|电话|手机)?\s*[:：]?\s*/i, "").trim();
        // 整行只有电话，或者电话在行尾（前面是名字等）
        if (!rest || !/\d/.test(rest) || l.trim().endsWith(m[0].trim())) {
          out.phone = m[0].trim();
          return rest;
        }
      }
      return l;
    })
    .map((l) => l.replace(/[,，]\s*$/, "").trim())
    .filter(Boolean);

  // 3) 国家
  lines = lines.filter((l) => {
    if (COUNTRY.test(l.replace(/[.,]/g, "").trim())) {
      out.country = "US";
      return false;
    }
    return true;
  });

  // 4) 城市 / 州 / 邮编：在一行里，或拆在相邻的几段里（一行逗号分隔时）
  let cityIdx = -1;
  for (let i = lines.length - 1; i >= 0 && cityIdx < 0; i--) {
    // 把最后几段拼起来试（“Austin” “TX 78701” 或 “Austin” “TX” “78701”）
    for (let span = 1; span <= 3 && i - span + 1 >= 0; span++) {
      const joined = lines.slice(i - span + 1, i + 1).join(", ");
      const m = joined.match(CITY_LINE);
      if (m && stateCode(m[2])) {
        let city = (m[1] ?? "").replace(/[,，]\s*$/, "").trim();
        let start = i - span + 1;
        // 州和邮编单独一行时，城市在上一行
        if (!city && start > 0 && !/\d/.test(lines[start - 1]) && !UNIT.test(lines[start - 1])) {
          city = lines[start - 1];
          start -= 1;
        }
        out.city = city;
        out.province = stateCode(m[2])!;
        out.zipCode = m[3];
        out.country ??= "US";
        lines.splice(start, i - start + 1);
        cityIdx = start;
        break;
      }
    }
  }
  if (cityIdx < 0) {
    // 只有邮编：单独一行 5 位数字
    const zi = lines.findIndex((l) => /^\d{5}(-\d{4})?$/.test(l));
    if (zi >= 0) {
      out.zipCode = lines[zi];
      lines.splice(zi, 1);
    }
  }

  // 5) 街道：第一行以门牌号开头或带街道后缀的；紧跟的 Apt/Suite 行作为地址2
  const streetIdx = lines.findIndex((l) => /^\d+[A-Za-z]?\s+\S/.test(l) || (STREET_HINT.test(l) && /\d/.test(l)) || /^p\.?\s*o\.?\s*box/i.test(l));
  if (streetIdx >= 0) {
    let street = lines[streetIdx];
    // 同一行里带着 Apt/Suite：拆到地址2
    const unitIn = street.match(/\s*,?\s+((?:apt|apartment|suite|ste|unit|#|bldg|fl|floor|rm|room)\b\.?\s*#?\s*[\w-]+)\s*$/i);
    if (unitIn && unitIn.index! > 0) {
      out.address2 = unitIn[1].trim();
      street = street.slice(0, unitIn.index).trim();
    }
    out.address1 = street;
    const next = lines[streetIdx + 1];
    const taken = [streetIdx];
    if (next && (UNIT.test(next) || (/\d/.test(next) && !out.address2))) {
      out.address2 = out.address2 ? `${out.address2} ${next}` : next;
      taken.push(streetIdx + 1);
    }
    // 名字在街道前面；街道前多出来的一行当公司名
    const before = lines.slice(0, streetIdx).filter((l) => !/\d{3,}/.test(l));
    if (before.length) Object.assign(out, splitName(before[0]));
    if (before.length > 1) out.corporateName = before.slice(1).join(" ");
    lines = lines.filter((_, i) => !taken.includes(i) && i >= streetIdx);
  } else if (lines.length) {
    Object.assign(out, splitName(lines[0]));
    lines = lines.slice(1);
    if (lines.length) out.address1 = lines.shift();
  }
  // 剩下认不出的行（例如公司、备注）附在地址2
  const rest = lines.filter((l) => l && l !== out.city);
  if (rest.length && !out.address2 && out.address1) out.address2 = rest.join(" ");
  return out;
}
