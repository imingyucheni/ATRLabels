/** 后台（设置 / 客户 / 对账单等）带变量的整句提示：[中文正则, 英文替换]，全部 ^...$ 锚定 */
export const admin1Patterns: [RegExp, string][] = [
  // 对账单说明（按“ · ”拆开逐段翻译）：已取消的面单
  [/^已取消（原价 ([\d.]+)，已退 ([\d.]+)）$/, "Cancelled (orig. $1, refunded $2)"],
];
