/** 后台（设置 / 客户 / 对账单等）带变量的整句提示：[中文正则, 英文替换]，全部 ^...$ 锚定 */
export const admin1Patterns: [RegExp, string][] = [
  [/^已备份：(.+)$/, "Backed up: $1"],
  [/^已恢复到 (.+)。恢复前的数据已另存为 (.+)，需要时可以再恢复回来。$/, "Restored $1. The previous data was saved as $2 in case you need it back."],
  [/^恢复失败：(.*)$/, "Restore failed: $1"],
  [/^已发送到 (.+)，请查收（也看看垃圾邮件箱）$/, "Sent to $1 — check the inbox (and spam folder)"],
  [/^发送失败：(.*)$/, "Send failed: $1"],
  [/^财务确认密码不正确（还可以再试 (\d+) 次）$/, "Incorrect finance PIN ($1 attempts left)"],
  [/^本月地址核对次数已用完（(\d+) 次），下个月自动恢复$/, "This month's address-check limit ($1) is used up; it resets next month"],
  [/^Google 暂时无法核对（(.*)）$/, "Google address check unavailable ($1)"],
  [/^已清除 (\d+) 张模拟 \/ 沙盒订单及相关扣款记录，真实订单没有变动。清除前的数据已备份为 (.+)$/, "Cleared $1 demo / sandbox orders and their charges. Real orders were not changed. A backup was saved as $2"],
  [/^已经有 (\d+) 张正式订单，不能清空（只能在上线前使用）$/, "There are already $1 live orders, so test data can't be cleared (only available before go-live)"],
  // 对账单说明（按“ · ”拆开逐段翻译）：已取消的面单
  [/^已取消（原价 ([\d.]+)，已退 ([\d.]+)）$/, "Cancelled (orig. $1, refunded $2)"],
  // 嘉谷万邑
  [/^已保存：开通了 (\d+) 个渠道，账户余额 \$([\d.]+)（预付）。点上面的“同步渠道”把嘉谷渠道加进渠道列表。还没有仓库 ID 的渠道：(.+)$/, "Saved: $1 services, balance $$$2 (prepaid). Click “Sync services” above to add Jiagu services. Services without a warehouse ID: $3"],
  [/^已保存：开通了 (\d+) 个渠道，账户余额 \$([\d.]+)（预付）。点上面的“同步渠道”把嘉谷渠道加进渠道列表。$/, "Saved: $1 services, balance $$$2 (prepaid). Click “Sync services” above to add Jiagu services."],
  [/^已保存：开通了 (\d+) 个渠道。点上面的“同步渠道”把嘉谷渠道加进渠道列表。还没有仓库 ID 的渠道：(.+)$/, "Saved: $1 services. Click “Sync services” above to add Jiagu services. Services without a warehouse ID: $2"],
  [/^已保存：开通了 (\d+) 个渠道。点上面的“同步渠道”把嘉谷渠道加进渠道列表。$/, "Saved: $1 services. Click “Sync services” above to add Jiagu services."],
  [/^连接成功：开通了 (\d+) 个渠道，账户余额 \$([\d.]+)（预付）。点上面的“同步渠道”把嘉谷渠道加进渠道列表。还没有仓库 ID 的渠道：(.+)$/, "Connected: $1 services, balance $$$2 (prepaid). Click “Sync services” above to add Jiagu services. Services without a warehouse ID: $3"],
  [/^连接成功：开通了 (\d+) 个渠道，账户余额 \$([\d.]+)（预付）。点上面的“同步渠道”把嘉谷渠道加进渠道列表。$/, "Connected: $1 services, balance $$$2 (prepaid). Click “Sync services” above to add Jiagu services."],
  [/^连接成功：开通了 (\d+) 个渠道。点上面的“同步渠道”把嘉谷渠道加进渠道列表。还没有仓库 ID 的渠道：(.+)$/, "Connected: $1 services. Click “Sync services” above to add Jiagu services. Services without a warehouse ID: $2"],
  [/^连接成功：开通了 (\d+) 个渠道。点上面的“同步渠道”把嘉谷渠道加进渠道列表。$/, "Connected: $1 services. Click “Sync services” above to add Jiagu services."],
  [/^(已保存|连接成功)，但连接测试失败：(.+)$/, "$1, but the connection test failed: $2"],
  [/^“(.+)”开通了 (\d+) 个（(.+)），客户看到的名称一样，只能选一个$/, "$2 services show to the customer as “$1” ($3). Pick only one."],
];
