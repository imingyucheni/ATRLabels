/** 带变量的整句提示：[中文正则, 英文替换]（用 $1 $2 引用） */
export const patterns: [RegExp, string][] = [
  /* ---------- 余额 / 报价（下单时服务器返回） ---------- */
  [/^余额不足：当前余额 (-?[\d.]+)（信用额度 ([\d.]+)），需要先充值才能继续下单$/, "Insufficient balance: current balance $1 (credit limit $2). Please top up to keep creating labels"],
  [/^余额不足：当前余额 (-?[\d.]+)，需要先充值才能继续下单$/, "Insufficient balance: current balance $1. Please top up to keep creating labels"],
  [/^余额不足：当前余额 (-?[\d.]+)（信用额度 ([\d.]+)），本单需要 ([\d.]+)，请先充值$/, "Insufficient balance: current balance $1 (credit limit $2); this label needs $3. Please top up first"],
  [/^余额不足：当前余额 (-?[\d.]+)，本单需要 ([\d.]+)，请先充值$/, "Insufficient balance: current balance $1; this label needs $2. Please top up first"],
  [/^价格已变化：当前报价 ([\d.]+) (\w+)，请确认后重新提交$/, "Price changed: the current quote is $1 $2. Please confirm and submit again"],

  /* ---------- 多箱寄出：渠道要求检查（lib/multiBox.ts）；括号里的具体原因由 index.ts 的 REASONS 再换成英文 ---------- */
  [/^([^；]+?) 至少 (\d+) 箱一起下单（现在 (\d+) 箱）$/, "$1 needs at least $2 boxes in one shipment (currently $3)"],
  [/^([^；]+?) 一票总重量至少 ([\d.]+) lb（现在 ([\d.]+) lb）$/, "$1 needs a total weight of at least $2 lb (currently $3 lb)"],
  [/^([^；]+?) 一票总重量最多 ([\d.]+) lb（现在 ([\d.]+) lb），请分成几票下单$/, "$1 allows at most $2 lb per shipment (currently $3 lb). Please split it into several shipments"],
  [/^按体积算的计费重 ([\d.]+) lb 超过 ([\d.]+) lb，会按公布价计费，请分票或换小一点的箱子$/, "Billable weight by volume is $1 lb, over $2 lb, so it would be billed at list rates. Split the shipment or use smaller boxes"],
  [/^([^；]+?) 单箱不能超过 ([\d.]+) lb（有一种箱子 ([\d.]+) lb）$/, "$1 allows at most $2 lb per box (one box is $3 lb)"],
  [/^([^；]+?) 只发美国本土 48 州，不能寄到 (\w+)$/, "$1 only ships within the contiguous 48 states, not to $2"],
  [/^([\d.]+×[\d.]+×[\d.]+) in 的箱子超出 ([^；]+?) 的最大限制（([^；]+)），不能发$/, "The $1 in box exceeds the $2 maximum limits ($3) and can't be shipped"],
  [/^([\d.]+×[\d.]+×[\d.]+) in 的箱子会产生额外处理费 \/ 超尺寸（([^；]+)），([^；]+?) 不能发$/, "The $1 in box would get Additional Handling / Oversize charges ($2), which $3 doesn't allow"],
  [/^(\d+) 箱会另收额外处理费（AHS，([^；]+)），每箱计费重最低按 (\d+) lb$/, "$1 box(es) will get an Additional Handling charge (AHS: $2), billed at least $3 lb per box"],
  [/^(\d+) 箱会另收超尺寸费（Oversize，([^；]+)），每箱计费重最低按 (\d+) lb$/, "$1 box(es) will get an Oversize charge ($2), billed at least $3 lb per box"],
  [/^商品 (\d+)：英文品名必填$/, "Item $1: English description is required"],
  [/^商品 (\d+)：英文品名不能有中文$/, "Item $1: English description can't contain Chinese characters"],
  [/^商品 (\d+)：海关编码（HS）至少 (\d+) 位数字$/, "Item $1: HS code must be at least $2 digits"],
  [/^海关编码（HS）至少 (\d+) 位数字$/, "HS code must be at least $1 digits"],

  /* ---------- 限时活动 / 负数加价 ---------- */
  [/^已绑定销售“(.+)”：给客户绑定这个销售和比例后，员工在“我的看板”里能看到提成$/, "Linked to sales profile “$1”: once customers are assigned to it with a rate, the staff member sees the commission under My dashboard"],
  [/^items\[(\d+)\]\.unitValue 必填（单件申报价值 USD，大于 0）$/, "items[$1].unitValue is required (declared value per unit in USD, greater than 0)"],
  [/^items\[(\d+)\]\.quantity 必填（大于等于 1）$/, "items[$1].quantity is required (at least 1)"],
  [/^(.*?)加价 %不能低于全局默认（(.+)），更低的价格请找主管理员设置$/, "$1Markup % can't be lower than the global default ($2); ask the owner for lower prices"],
  [/^(.*?)固定加价不能低于全局默认（(.+)），更低的价格请找主管理员设置$/, "$1Fixed markup can't be lower than the global default ($2); ask the owner for lower prices"],
  [/^(.*?)最低利润不能低于全局默认（(.+)），更低的价格请找主管理员设置$/, "$1Minimum profit can't be lower than the global default ($2); ask the owner for lower prices"],
  [/^(.+?)：加价太低会低于成本，员工不能这样设置，请找主管理员$/, "$1: this markup would price below cost; staff can't set it — please ask the owner"],
  [/^这个渠道的申报价值只能用美元（USD），请把币种 (\S+) 换算成美元后再下单$/, "This service only accepts declared values in USD. Please convert $1 to USD and try again"],
  [/^这个渠道在 (\S+) ~ (\S+) 已经有活动「(.+)」，日期不能重叠（先停用或删除原来的活动）$/, "This service already has the promotion “$3” from $1 to $2; dates can't overlap (disable or delete the existing promotion first)"],
  [/^已恢复 (\d+) 项加价，之后的报价和下单按恢复后的价格$/, "Restored $1 markup(s); new quotes and orders use the restored pricing"],
  [/^(.*?)限时活动期间所有客户都按活动价；这里填的负数加价要等活动结束后才生效，那时没有活动返利，会按成本价出单，所以不能填。只想在活动期间优惠，在“设置 → 限时活动价”里设置就行$/, "$1During a promotion every customer gets the promo price; a negative markup entered here would only apply after the promotion ends, when there's no promo rebate, so labels would be sold at cost. To discount only during the promotion, use Settings → Limited-time promotions"],

  /* ---------- 服务商接口超时 / 连不上 ---------- */
  [/^(.+?) 接口超时：(\d+) 秒没有响应，请稍后再试$/, "$1 API timed out (no response in $2 s). Please try again later"],
  [/^(.+?) 接口连不上(（.+?）)?，请稍后再试$/, "Can't reach the $1 API$2. Please try again later"],
  [/^已同步 (\d+) 个渠道；以下服务商这次没取到，原来的渠道照常可用，稍后再点一次同步：(.+)$/, "Synced $1 services. These providers didn't respond this time (their existing services still work; sync again later): $2"],

  /* ---------- DHL：正式模式下还是测试环境、提交结果未知 ---------- */
  [/^\[10023\] 物流产品已停用（DHL 服务商账号还是测试环境：测试环境的面单不能真实寄件，正式模式下不报价、不出单。请到 设置 → DHL Express 填正式账号，环境选“正式”）$/, "[10023] Service is disabled (DHL is still set to its test environment: test labels can't be shipped, so DHL doesn't quote or create labels in live mode. Go to Settings → DHL Express, enter the live account and set the environment to Live)"],
  [/^DHL 提交结果未知（(.+)）：没有收到 DHL 的运单号，不知道运单有没有建成。请到 DHL 后台（MyDHL\+）按参考号 (.+?) 核对：没有建单的申请取消后点“确认已取消”（全额退款）；已经建单的联系技术补录面单$/, "DHL submission result unknown ($1): no DHL waybill number was received, so we don't know whether the shipment was created. Check reference $2 in MyDHL+: if it wasn't created, request cancellation and click “Confirm cancelled” (full refund); if it was, contact tech support to attach the label"],
  [/^DHL 提交结果未知：没有收到 DHL 的运单号，不知道运单有没有建成。请到 DHL 后台（MyDHL\+）按参考号 (.+?) 核对：没有建单的申请取消后点“确认已取消”（全额退款）；已经建单的联系技术补录面单$/, "DHL submission result unknown: no DHL waybill number was received, so we don't know whether the shipment was created. Check reference $1 in MyDHL+: if it wasn't created, request cancellation and click “Confirm cancelled” (full refund); if it was, contact tech support to attach the label"],
  [/^(?:\[2\] )?DHL 提交结果未知，系统确认不了这票有没有在 DHL 建单，不能自动取消：请到 DHL 后台（MyDHL\+）按参考号 (.+?) 核对，没有建单或已作废的再点“确认已取消”$/, "DHL submission result unknown — we can't confirm whether DHL created this shipment, so it can't be cancelled automatically. Check reference $1 in MyDHL+; if it wasn't created (or was voided), click “Confirm cancelled”"],

  /* ---------- 多箱面单合成 PDF ---------- */
  [/^多箱面单第 (\d+) 箱（共 (\d+) 箱）是 (\S+) 格式，不能合成 PDF：请到服务商后台下载这票的全部面单$/, "Multi-box label for box $1 of $2 is in $3 format and can't be merged into the PDF. Download all labels for this shipment from the provider's portal"],

  /* ---------- 账户流水说明（按“ · ”拆开逐段翻译） ---------- */
  [/^充值申请 #(\d+)$/, "Top-up request #$1"],
  [/^支付宝 ¥([\d.]+)（汇率 ([\d.]+)）$/, "Alipay ¥$1 (rate $2)"],
  [/^申请 \$([\d.]+)，实际入账 \$([\d.]+)$/, "requested $$$1, credited $$$2"],
  [/^参考号 (.+)$/, "Ref. $1"],

  /* ---------- 批量导入 / 店铺订单 ---------- */
  [/^表格里的物流产品“(.+)”这单没有报价，已暂选最便宜的渠道，请确认后再勾选提交$/, "The service “$1” from the file has no quote for this order. The cheapest service was picked for now — please check, then tick it to submit"],
  [/^表格里的物流产品“(.+)”不在这个账户开通的渠道里，已暂选最便宜的渠道，请确认后再勾选提交$/, "The service “$1” from the file isn't enabled on this account. The cheapest service was picked for now — please check, then tick it to submit"],
  [/^订单号 (.+) 以前下过单（(.+?)），可能是同一单，默认不提交。确认不是同一单再勾选$/, "Order ref $1 was shipped before ($2). It may be the same order, so it isn't submitted by default — tick it if it's a different order"],
  [/^Shopify 授权已失效，请重新连接店铺（(.+)）$/, "Shopify authorization expired — please reconnect the store ($1)"],
  [/^Shopify 授权刷新失败：(.+)$/, "Couldn't refresh the Shopify authorization: $1"],

  /* ---------- 补差原因（按“ · ”拆开逐段翻译；前面的原始原因保留） ---------- */
  [/预报 (\S+) (\S+) → 结算 (\S+) (\S+)（超出 (\S+) (\S+)）$/, "declared $1 $2 → billed $3 $4 ($5 $6 over)"],
  [/预报 (\S+) (\S+) → 结算 (\S+) (\S+)（少 (\S+) (\S+)）$/, "declared $1 $2 → billed $3 $4 ($5 $6 under)"],
  [/预报 (\S+) (\S+) → 结算 (\S+) (\S+)（无差异）$/, "declared $1 $2 → billed $3 $4 (no difference)"],
  [/^实重 (.+)$/, "Actual weight $1"],
  [/^分区 (.+) → (zone\d+)$/, "Zone $1 → $2"],
];
