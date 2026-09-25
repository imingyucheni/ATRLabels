/** 后台（设置 / 客户 / 对账单等）带变量的整句提示：[中文正则, 英文替换]，全部 ^...$ 锚定 */
export const admin1Patterns: [RegExp, string][] = [
  [/^已清空测试数据，所有客户余额归零。清空前的数据已备份为 (.+)$/, "Test data cleared and all balances reset to 0. A backup was saved as $1"],
  [/^已经有 (\d+) 张正式订单，不能清空（只能在上线前使用）$/, "There are already $1 live orders, so test data can't be cleared (only available before go-live)"],
  // 对账单说明（按“ · ”拆开逐段翻译）：已取消的面单
  [/^已取消（原价 ([\d.]+)，已退 ([\d.]+)）$/, "Cancelled (orig. $1, refunded $2)"],
];
