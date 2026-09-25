/** 带变量的整句提示：[中文正则, 英文替换]（用 $1 $2 引用） */
export const patterns: [RegExp, string][] = [
  /* ---------- 余额 / 报价（下单时服务器返回） ---------- */
  [/^余额不足：当前余额 (-?[\d.]+)（信用额度 ([\d.]+)），需要先充值才能继续下单$/, "Insufficient balance: current balance $1 (credit limit $2). Please top up to keep creating labels"],
  [/^余额不足：当前余额 (-?[\d.]+)，需要先充值才能继续下单$/, "Insufficient balance: current balance $1. Please top up to keep creating labels"],
  [/^余额不足：当前余额 (-?[\d.]+)（信用额度 ([\d.]+)），本单需要 ([\d.]+)，请先充值$/, "Insufficient balance: current balance $1 (credit limit $2); this label needs $3. Please top up first"],
  [/^余额不足：当前余额 (-?[\d.]+)，本单需要 ([\d.]+)，请先充值$/, "Insufficient balance: current balance $1; this label needs $2. Please top up first"],
  [/^价格已变化：当前报价 ([\d.]+) (\w+)，请确认后重新提交$/, "Price changed: the current quote is $1 $2. Please confirm and submit again"],

  /* ---------- 账户流水说明（按“ · ”拆开逐段翻译） ---------- */
  [/^充值申请 #(\d+)$/, "Top-up request #$1"],
  [/^支付宝 ¥([\d.]+)（汇率 ([\d.]+)）$/, "Alipay ¥$1 (rate $2)"],
  [/^申请 \$([\d.]+)，实际入账 \$([\d.]+)$/, "requested $$$1, credited $$$2"],
  [/^参考号 (.+)$/, "Ref. $1"],

  /* ---------- 补差原因（按“ · ”拆开逐段翻译；前面的原始原因保留） ---------- */
  [/预报 (\S+) (\S+) → 结算 (\S+) (\S+)（超出 (\S+) (\S+)）$/, "declared $1 $2 → billed $3 $4 ($5 $6 over)"],
  [/预报 (\S+) (\S+) → 结算 (\S+) (\S+)（少 (\S+) (\S+)）$/, "declared $1 $2 → billed $3 $4 ($5 $6 under)"],
  [/预报 (\S+) (\S+) → 结算 (\S+) (\S+)（无差异）$/, "declared $1 $2 → billed $3 $4 (no difference)"],
  [/^实重 (.+)$/, "Actual weight $1"],
  [/^分区 (.+) → (zone\d+)$/, "Zone $1 → $2"],
];
