/** 后台（报表 / 派送范围 / 导出）带变量的整句提示：[中文正则, 英文替换] */
export const admin3Patterns: [RegExp, string][] = [
  [/^包裹偏小：最长边 ([\d.]+) in、第二长边 ([\d.]+) in，这个渠道要求至少 ([\d.]+) × ([\d.]+) in（约 (\d+) × (\d+) cm）。面单可能贴不下，可能被拒收或加收费用，建议用大一点的包装或填写实际外箱尺寸$/, "Package is small: longest side $1 in, second side $2 in; this service needs at least $3 × $4 in (about $5 × $6 cm). The label may not fit and the package may be refused or surcharged — use a bigger box or enter the actual box size"],
  /* ---------- lib/coverage.ts：邮编表识别结果 / 派送范围提示 ---------- */
  [/^按“(.+)”列筛选 (\S+)$/, "Filtered by column \"$1\" = $2"],
  [/^取 (\S+) 列有分区的邮编$/, "ZIPs with a zone in column $1"],
  [/^(\d+) 个重量档（最高 ([\d.]+) lb），分区 (.*)$/, "$1 weight tiers (up to $2 lb), zones $3"],
  [/^该地址不在此渠道的派送范围内（邮编 (\S+)，(\S+) 查询过）$/, "This address is outside this service's delivery area (ZIP $1, checked $2)"],
  [/^该地址不在此渠道的派送范围内（邮编 (\S+) 不在邮编表里）$/, "This address is outside this service's delivery area (ZIP $1 is not in the ZIP table)"],

  /* ---------- 对账单说明（按“ · ”拆开逐段翻译）：已取消的面单 ---------- */
  [/^已取消（原价 ([\d.]+)，已退 ([\d.]+)）$/, "Cancelled (was $1, refunded $2)"],
];
