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
/** 常见的其他国家（国际件）：名字 → 二字码 */
const COUNTRIES: [RegExp, string][] = [
  [/^(canada|ca|加拿大)$/i, "CA"], [/^(united kingdom|uk|u\.k\.|great britain|gb|england|scotland|wales|英国)$/i, "GB"],
  [/^(australia|au|澳大利亚|澳洲)$/i, "AU"], [/^(germany|deutschland|de|德国)$/i, "DE"], [/^(france|fr|法国)$/i, "FR"],
  [/^(japan|jp|日本)$/i, "JP"], [/^(china|cn|中国|中国大陆)$/i, "CN"], [/^(mexico|méxico|mx|墨西哥)$/i, "MX"],
  [/^(italy|it|意大利)$/i, "IT"], [/^(spain|es|西班牙)$/i, "ES"], [/^(netherlands|holland|nl|荷兰)$/i, "NL"],
  [/^(new zealand|nz|新西兰)$/i, "NZ"], [/^(singapore|sg|新加坡)$/i, "SG"], [/^(hong kong|hk|香港)$/i, "HK"],
  [/^(taiwan|tw|台湾)$/i, "TW"], [/^(south korea|korea|kr|韩国)$/i, "KR"], [/^(ireland|ie|爱尔兰)$/i, "IE"],
  [/^(sweden|se|瑞典)$/i, "SE"], [/^(switzerland|ch|瑞士)$/i, "CH"], [/^(belgium|be|比利时)$/i, "BE"],
];
const CA_PROV = /^(.*?)[,\s]+(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\.?[,\s]+([A-Z]\d[A-Z])\s?(\d[A-Z]\d)$/i;
const AU_STATE = /^(.*?)[,\s]+(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)[,\s]+(\d{4})$/i;
const UK_POST = /^(.*?)[,\s]*\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;
// 国际电话：+44 20 7946 0958 / +86 138 0013 8000
const INTL_PHONE = /\+(?!1[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b)\d{1,3}[\s.-]?(?:\(?\d+\)?[\s.-]?){2,6}\d/;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
// 电话：+1 (512) 555-0100 / 512.555.0100 / 5125550100 / 带分机
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:ext\.?|x|#)\s*\d{1,6})?/i;
const LABEL = /^\s*(ship\s*to|shipping\s*address|recipient|sender|name|full\s*name|contact|address(\s*line)?\s*\d?|addr|phone(\s*number)?|tel(ephone)?|mobile|email|e-mail|收件人|寄件人|联系人|姓名|名字|电话|手机|联系电话|地址|详细地址|邮箱|邮编|城市|州)\s*[:：]\s*/i;
const UNIT = /^(apt|apartment|suite|ste|unit|#|bldg|building|fl|floor|rm|room|dept|po box|p\.o\. box)\b\.?/i;
const GLUED_SUFFIX = /\b(St|Ave|Rd|Blvd|Dr|Ln|Ct|Way|Pl|Pkwy|Hwy|Cir|Ter|Trl|Street|Avenue|Road|Drive|Lane|Court|Place|Boulevard)(?=[A-Z][a-z])/g;
const STREET_HINT = /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|way|pl|place|pkwy|parkway|hwy|highway|cir|circle|ter|terrace|trl|trail|loop|sq|square)\b\.?/i;

// “City, ST 12345” / “City ST 12345-6789” / “City, Texas 12345” / “ST 12345”
// 城市部分用“尽量不要”（??）：先试整行开头就是州名（West Virginia 25301），避免把州名的前半截当成城市
const CITY_LINE = new RegExp(`^(?:(.*?)[,\\s]+)??(${STATE_NAMES}|[A-Za-z]{2})\\.?[,\\s]+(\\d{5}(?:-?\\d{4}|-\\d{0,3})?)$`, "i");
/** 9 位邮编没写横杠（972011234）时补成 97201-1234；后 4 位没写全（91789-281）只留前 5 位 */
const zip9 = (z: string) => (/^\d{9}$/.test(z) ? `${z.slice(0, 5)}-${z.slice(5)}` : /^\d{5}-\d{0,3}$/.test(z) ? z.slice(0, 5) : z);

/**
 * “城市”里其实带着街道（以门牌号开头）：拆成街道 + 城市。
 * 有逗号按最后一个逗号拆；没有逗号按最后一个街道后缀（St / Ave / Rd…）拆，后缀后面的方向（NW）、公寓号（Apt 4）归街道。
 */
function splitStreetCity(text: string): { street: string; city: string } | null {
  const t = text.trim();
  if (!/^\d+[A-Za-z]?\s+\S/.test(t) && !/^p\.?\s*o\.?\s*box/i.test(t)) return null;
  const comma = t.lastIndexOf(",");
  if (comma > 0) {
    const city = t.slice(comma + 1).trim();
    return city && !/\d/.test(city) ? { street: t.slice(0, comma).trim(), city } : null;
  }
  const re = new RegExp(STREET_HINT.source, "gi");
  let end = -1;
  for (let m = re.exec(t); m; m = re.exec(t)) end = m.index + m[0].length;
  if (end < 0) return null;
  let rest = t.slice(end).trim();
  let street = t.slice(0, end).trim();
  const tail = rest.match(/^((?:n|s|e|w|ne|nw|se|sw)\.?\s+)?((?:apt|apartment|suite|ste|unit|#|bldg|fl|floor|rm|room)\.?\s*#?\s*[\w-]+\s+)?/i);
  if (tail && tail[0]) {
    street = `${street} ${tail[0].trim()}`;
    rest = rest.slice(tail[0].length).trim();
  }
  return rest && !/\d/.test(rest) ? { street, city: rest } : null;
}

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
    // 从网页复制时换行丢了，街道后缀和城市粘在一起（“8th AveWest Bend”）：在中间补一个空格
    .map((l) => l.replace(GLUED_SUFFIX, "$1 "))
    .map((l) => l.replace(LABEL, ""))
    .flatMap((l) => l.split(/[,;，；]\s*/))
    .map((l) => l.replace(LABEL, "").trim())
    .filter(Boolean);

  // 国际电话（带 + 国家区号，不是 +1）：在任意位置都先取出来
  if (!out.phone) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(INTL_PHONE);
      if (m) {
        out.phone = m[0].trim();
        lines[i] = lines[i].replace(m[0], " ").replace(/^(phone|tel|电话|手机)?\s*[:：]?\s*/i, "").trim();
        break;
      }
    }
    lines = lines.filter(Boolean);
  }
  // 姓名、电话、街道写在同一行（“Jane Roe 512-555-0100 500 Congress Ave …”）：电话取出，姓名和街道分成两行
  lines = lines.flatMap((l) => {
    if (out.phone) return [l];
    const m = l.match(new RegExp(`^([A-Za-z][A-Za-z .'-]*?)\\s+(${PHONE.source})\\s+(\\d+[A-Za-z]?\\s+.+)$`, "i"));
    if (!m) return [l];
    out.phone = m[2].trim();
    return [m[1].trim(), m[m.length - 1].trim()];
  });
  // 姓名紧跟着街道（“Jane Roe 500 Congress Ave”）：在门牌号前拆开
  lines = lines.flatMap((l) => {
    const m = l.match(/^([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3})\s+(\d+[A-Za-z]?\s+.*)$/);
    return m && STREET_HINT.test(m[2]) && !STREET_HINT.test(m[1]) && !UNIT.test(m[1]) && !/^(po|p\.o\.)\b/i.test(m[1]) ? [m[1], m[2]] : [l];
  });

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
    const c = l.replace(/[.,]/g, "").trim();
    if (COUNTRY.test(c)) {
      out.country = "US";
      return false;
    }
    const other = COUNTRIES.find(([re]) => re.test(c));
    if (other && lines.length > 1) {
      out.country = other[1];
      return false;
    }
    return true;
  });

  // 3b) 国际件的城市 / 省州 / 邮编（加拿大、澳洲、英国，以及“10115 Berlin” / “Paris 75001” 这类写法）
  if (out.country && out.country !== "US") {
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      let m: RegExpMatchArray | null;
      let hit: Partial<Address> | null = null;
      if (out.country === "CA" && (m = l.match(CA_PROV))) hit = { city: m[1], province: m[2].toUpperCase(), zipCode: `${m[3]} ${m[4]}`.toUpperCase() };
      else if (out.country === "AU" && (m = l.match(AU_STATE))) hit = { city: m[1], province: m[2].toUpperCase(), zipCode: m[3] };
      else if (out.country === "GB" && (m = l.match(UK_POST))) hit = { city: m[1], zipCode: `${m[2]} ${m[3]}`.toUpperCase() };
      else if ((m = l.match(/^(\d{4,6})\s+([A-Za-zÀ-ÿ][\w\sÀ-ÿ.'-]*)$/))) hit = { zipCode: m[1], city: m[2] };
      else if ((m = l.match(/^([A-Za-zÀ-ÿ][\w\sÀ-ÿ.'-]*?)\s+(\d{4,6})$/)) && !/^\d/.test(l)) hit = { city: m[1], zipCode: m[2] };
      if (!hit) continue;
      let city = (hit.city ?? "").replace(/[,，]\s*$/, "").trim();
      // 只有邮编（英国 “NW1 6XE” 单独一行）：城市在上一行
      if (!city && i > 0 && !/\d/.test(lines[i - 1])) {
        city = lines[i - 1];
        lines.splice(i - 1, 2);
      } else lines.splice(i, 1);
      Object.assign(out, hit, { city });
      break;
    }
  }

  // 4) 城市 / 州 / 邮编：在一行里，或拆在相邻的几段里（一行逗号分隔时）
  let cityIdx = out.country && out.country !== "US" && out.zipCode ? 0 : -1;
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
        } else if (!city && start > 0 && splitStreetCity(lines[start - 1])) {
          // 上一段是“街道 + 城市”连在一起（529 S 8th Ave West Bend）：城市拆出来，街道留在原位
          const sp = splitStreetCity(lines[start - 1])!;
          lines[start - 1] = sp.street;
          city = sp.city;
        }
        // 街道和城市写在同一行（“529 S 8th Ave West Bend, WI 53095”）：把街道拆出来，放回去给后面识别街道
        const split = city ? splitStreetCity(city) : null;
        if (split) city = split.city;
        out.city = city;
        out.province = stateCode(m[2])!;
        out.zipCode = zip9(m[3]);
        out.country ??= "US";
        lines.splice(start, i - start + 1, ...(split ? [split.street] : []));
        cityIdx = start;
        break;
      }
    }
  }
  if (cityIdx < 0) {
    // 只有邮编：单独一行 5 位数字
    const zi = lines.findIndex((l) => /^\d{5}(-?\d{4}|-\d{0,3})?$/.test(l));
    if (zi >= 0) {
      out.zipCode = zip9(lines[zi]);
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
