/** 国家 / 美国州代码（前后端通用） */

/** 常用国家（下拉框里显示）；美国放第一个 */
export const COMMON_COUNTRIES: [string, string][] = [
  ["US", "美国"], ["CA", "加拿大"], ["MX", "墨西哥"], ["PR", "波多黎各"], ["CN", "中国"], ["HK", "中国香港"], ["TW", "中国台湾"],
  ["JP", "日本"], ["KR", "韩国"], ["GB", "英国"], ["DE", "德国"], ["FR", "法国"], ["AU", "澳大利亚"],
];

/** ISO 3166-1 二字码（校验用） */
const ISO = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ " +
    "DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ " +
    "OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
    "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

export const isCountryCode = (c: string) => ISO.has((c ?? "").trim().toUpperCase());

export const US_STATES: [string, string][] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"],
  ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
  ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"],
  ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
  ["PR", "Puerto Rico"], ["VI", "Virgin Islands"], ["GU", "Guam"], ["AS", "American Samoa"], ["MP", "Northern Mariana Islands"],
  ["AA", "Armed Forces Americas"], ["AE", "Armed Forces Europe"], ["AP", "Armed Forces Pacific"],
];
const US_STATE_SET = new Set(US_STATES.map(([c]) => c));
const US_STATE_BY_NAME = new Map(US_STATES.map(([c, n]) => [n.toLowerCase(), c]));

/** “ca” / “California” → “CA”；认不出返回 null */
export function usStateCode(v: string): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  const up = t.toUpperCase();
  if (US_STATE_SET.has(up)) return up;
  return US_STATE_BY_NAME.get(t.toLowerCase()) ?? null;
}

export const isUsZip = (z: string) => /^\d{5}(-?\d{4})?$/.test((z ?? "").trim());
