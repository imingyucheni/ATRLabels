/**
 * 后台（面单、财务、补差、actions.ts / batchActions.ts）带变量的整句提示：[中文正则, 英文替换]。
 * 中文原文不改，只在显示时翻译。全部用 ^...$ 锚定。
 */

const NUM = "(-?[\\d.]+)";
const NEG_RULE = "加价、固定加价、最低利润不能为负数（会低于成本出单）";
const NEG_RULE_EN = "markup %, fixed markup and minimum profit can't be negative (would sell below cost)";

/** 关联补差时的提醒：warn.join("；") + “。确认没关联错的话……” */
const LINK_TAIL = "。确认没关联错的话，勾选“仍然关联”再提交。";
const LINK_TAIL_EN = ". If the link is correct, tick “Link anyway” and submit again.";
const CARRIER = "补差原因里的渠道和面单渠道（(.+)）可能不一致";
const CARRIER_EN = "The service in the adjustment reason may not match the label's service ($1)";
/** refreshFxAction：实时汇率 x（来源），加点 m → 充值汇率 r */
const FX_TAIL = `，加点 ${NUM} → 充值汇率 ${NUM}`;
const FX_TAIL_EN = (m: string, r: string) => `, markup ${m} → top-up rate ${r}`;
const LINK_WARN: [string, string][] = [
  ["这张面单已经取消", "This label is cancelled"],
  ["这张面单是异常状态", "This label is in exception status"],
];

export const admin2Patterns: [RegExp, string][] = [
  // 渠道加价为负
  [new RegExp(`^(.+)：${NEG_RULE}$`), `$1: ${NEG_RULE_EN}`],

  // 充值 / 调账
  [new RegExp(`^已充值 ${NUM}，当前余额 ${NUM}$`), "Topped up $1; balance is now $2"],
  [new RegExp(`^已调账 ${NUM}，当前余额 ${NUM}$`), "Adjusted $1; balance is now $2"],

  // 渠道
  [/^已同步 (\d+) 个渠道$/, "Synced $1 services"],
  [/^已保存，开通 (\d+) 个渠道$/, "Saved; $1 services enabled"],

  // 补差关联
  ...LINK_WARN.map(([zh, en]): [RegExp, string] => [new RegExp(`^${zh}；${CARRIER}${LINK_TAIL}$`), `${en}; ${CARRIER_EN.charAt(0).toLowerCase() + CARRIER_EN.slice(1)}${LINK_TAIL_EN}`]),
  ...LINK_WARN.map(([zh, en]): [RegExp, string] => [new RegExp(`^${zh}${LINK_TAIL}$`), `${en}${LINK_TAIL_EN}`]),
  [new RegExp(`^${CARRIER}${LINK_TAIL}$`), `${CARRIER_EN}${LINK_TAIL_EN}`],
  [/^已关联到 (.+)（(.+)），向客户补收 ([\d.]+)$/, "Linked to $1 ($2); charged the customer $3"],
  [/^已关联到 (.+)（(.+)），向客户退回 ([\d.]+)$/, "Linked to $1 ($2); refunded the customer $3"],

  // 充值审核
  [/^#(\d+) 已入账$/, "#$1 credited"],
  [/^#(\d+) 已拒绝$/, "#$1 rejected"],

  // 汇率
  [/^实时汇率获取失败，当前使用 备用汇率（实时汇率获取失败）：(.+)$/, "Couldn't fetch the live rate; using the fallback rate: $1"],
  [/^实时汇率获取失败，当前使用 手动设置：(.+)$/, "Couldn't fetch the live rate; using the manual rate: $1"],
  [/^实时汇率获取失败，当前使用 (.+)：(.+)$/, "Couldn't fetch the live rate; using $1: $2"],
  [new RegExp(`^实时汇率 ${NUM}（Frankfurter（欧洲央行）（最近一次））${FX_TAIL}$`), `Live rate $1 (Frankfurter (ECB), last known)${FX_TAIL_EN("$2", "$3")}`],
  [new RegExp(`^实时汇率 ${NUM}（Frankfurter（欧洲央行））${FX_TAIL}$`), `Live rate $1 (Frankfurter (ECB))${FX_TAIL_EN("$2", "$3")}`],
  [new RegExp(`^实时汇率 ${NUM}（手动设置）${FX_TAIL}$`), `Rate $1 (manual)${FX_TAIL_EN("$2", "$3")}`],
  [new RegExp(`^实时汇率 ${NUM}（(.+)（最近一次））${FX_TAIL}$`), `Live rate $1 ($2, last known)${FX_TAIL_EN("$3", "$4")}`],
  [new RegExp(`^实时汇率 ${NUM}（(.+)）${FX_TAIL}$`), `Live rate $1 ($2)${FX_TAIL_EN("$3", "$4")}`],

  // 重置密码
  [/^(.+) 的新密码：(\S+)　请发给客户（只显示这一次）$/, "New password for $1: $2 — send it to the customer (shown only once)"],

  // ShipBest 连接
  [/^已保存，但连接测试失败：(.+)$/, "Saved, but the connection test failed: $1"],

  // 批量选渠道（batchActions.ts）
  [/^已修改 (\d+) 单；(\d+) 单该渠道没有报价，保持原选择$/, "Updated $1 orders; $2 orders have no rate from that service and kept their previous choice"],

  // service.ts 取消 / 刷新
  [/^接口取消未成功：([^]*)。请在 OMS 联系 ShipBest 人工取消，完成后点“确认已取消”。$/, "API cancellation failed: $1. Contact ShipBest in the OMS to cancel manually, then click “Confirm cancelled”."],
  [/^下载面单失败：HTTP (\d+)$/, "Failed to download label: HTTP $1"],
];
