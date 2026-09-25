/**
 * 订单相关、带变量的整句提示：[中文正则, 英文替换]（用 $1 $2 引用）。
 * 来源：lib/service.ts 下单校验、lib/batch.ts 批量导入、lib/ledger.ts 余额不足、portal/actions.ts 等。
 * 中文原文不改，只在显示时翻译。全部用 ^...$ 锚定，避免误伤别的提示。
 */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const WHO: [string, string][] = [
  ["寄件人", "Sender"],
  ["收件人", "Recipient"],
];

/** 必填字段（service.ts checkAddress） */
const REQUIRED: [string, string][] = [
  ["信息", "information"],
  ["名", "first name"],
  ["姓", "last name"],
  ["国家二字码", "country code"],
  ["城市", "city"],
  ["地址1", "address line 1"],
  ["邮编", "ZIP code"],
  ["州", "state"],
];

/** 长度限制字段 */
const MAXLEN: [string, string][] = [
  ["名", "first name"],
  ["姓", "last name"],
  ["电话", "phone"],
  ["邮箱", "email"],
  ["省/州", "state/province"],
  ["城市", "city"],
  ["区/县", "district"],
  ["邮编", "ZIP code"],
  ["公司", "company"],
  ["税号", "tax ID"],
  ["门牌号", "house number"],
  ["街道", "street"],
  ["地址1", "address line 1"],
  ["地址2", "address line 2"],
];

const PKG: [string, string][] = [
  ["长", "length"],
  ["宽", "width"],
  ["高", "height"],
  ["重量", "weight"],
];

const SKU_ERR: [string, string][] = [
  ["SKU 必填", "SKU is required"],
  ["中文品名必填", "Chinese item name is required"],
  ["英文品名必填", "English item name is required"],
  ["商品性质必填", "goods type is required"],
  ["数量必须大于 0", "quantity must be greater than 0"],
  ["申报单价必须大于 0", "declared unit value must be greater than 0"],
];

/** portal/actions.ts 保存寄件地址：“请填写：姓名、地址1、城市、邮编”的各种组合 */
const FILL: [string, string][] = [
  ["姓名", "name"],
  ["地址1", "address line 1"],
  ["城市", "city"],
  ["邮编", "ZIP code"],
];
const fillCombos: [RegExp, string][] = [];
for (let mask = 1; mask < 1 << FILL.length; mask++) {
  const pick = FILL.filter((_, i) => mask & (1 << i));
  fillCombos.push([new RegExp(`^请填写：${esc(pick.map((p) => p[0]).join("、"))}$`), `Please fill in: ${pick.map((p) => p[1]).join(", ")}`]);
}

/** ledger.ts 余额不足（有无信用额度 × 两种余额规则），以及批量提交时包在“已暂停”里的版本 */
const NUM = "(-?[\\d.]+)";
const balance: [string, string][] = [
  [`余额不足：当前余额 ${NUM}，需要先充值才能继续下单`, "Insufficient balance: current balance $1. Please top up to continue."],
  [`余额不足：当前余额 ${NUM}（信用额度 ${NUM}），需要先充值才能继续下单`, "Insufficient balance: current balance $1 (credit limit $2). Please top up to continue."],
  [`余额不足：当前余额 ${NUM}，本单需要 ${NUM}，请先充值`, "Insufficient balance: current balance $1, this label needs $2. Please top up."],
  [`余额不足：当前余额 ${NUM}（信用额度 ${NUM}），本单需要 ${NUM}，请先充值`, "Insufficient balance: current balance $1 (credit limit $2), this label needs $3. Please top up."],
];
const PAUSED_ZH = esc("余额不足，已暂停。充值后点“提交订单”继续。");
const PAUSED_EN = "Insufficient balance — paused. Top up and click “Submit orders” to continue.";

export const orderPatterns: [RegExp, string][] = [
  // 地址校验
  ...WHO.flatMap(([w, we]) => [
    ...REQUIRED.map(([l, le]): [RegExp, string] => [new RegExp(`^${w}${esc(l)}必填$`), `${we} ${le} is required`]),
    [new RegExp(`^${w}国家请填二字码，例如 US$`), `${we} country must be a 2-letter code, e.g. US`] as [RegExp, string],
    [new RegExp(`^${w}国家代码“(.+)”不存在，请从下拉框选择$`), `${we} country code “$1” doesn't exist. Please pick one from the list.`] as [RegExp, string],
    [new RegExp(`^${w}州“(.+)”不正确，请从下拉框选择（例如 CA、TX）$`), `${we} state “$1” is invalid. Please pick one from the list (e.g. CA, TX).`] as [RegExp, string],
    [new RegExp(`^${w}邮编“(.+)”格式不对，美国邮编是 5 位数字（可以带 4 位，例如 78701-1234）$`), `${we} ZIP code “$1” is invalid. US ZIP codes are 5 digits (optionally +4, e.g. 78701-1234).`] as [RegExp, string],
    ...MAXLEN.map(([l, le]): [RegExp, string] => [new RegExp(`^${w}${esc(l)}最多 (\\d+) 个字符$`), `${we} ${le} can be at most $1 characters`]),
  ]),
  // 包裹 / 商品校验
  ...PKG.map(([l, le]): [RegExp, string] => [new RegExp(`^包裹${l}必须大于 0$`), `Package ${le} must be greater than 0`]),
  ...SKU_ERR.map(([l, le]): [RegExp, string] => [new RegExp(`^商品 (\\d+)：${esc(l)}$`), `Item $1: ${le}`]),
  // 下单
  [/^价格已变化：当前报价 ([\d.]+) (\w+)，请确认后重新提交$/, "Price changed: current rate is $1 $2. Please confirm and submit again."],
  [/^提交结果未知（(.*)），请稍后点“刷新状态”$/, "Submission result unknown ($1). Please click “Refresh status” later."],
  [/^国家\[(\w+)\],邮编\[([^\]]+)\]不通邮$/, "Country [$1], ZIP [$2]: not serviceable"],
  ...balance.map(([zh, en]): [RegExp, string] => [new RegExp(`^${zh}$`), en]),
  ...balance.map(([zh, en]): [RegExp, string] => [new RegExp(`^${PAUSED_ZH}（${zh}）$`), `${PAUSED_EN} (${en})`]),
  [new RegExp(`^${PAUSED_ZH}（(.*)）$`), `${PAUSED_EN} ($1)`],
  [/^下单失败：(.+)$/, "Failed to create label: $1"],
  // 批量导入
  [/^表格缺少必填列：(.+)$/, "Spreadsheet is missing required columns: $1"],
  [/^订单号 (.+) 已经出过面单（(.+)，(\d{4}-\d\d-\d\d)），可能是重复导入，默认不提交$/, "Order ref $1 was already labeled ($2, $3). Possible duplicate — not submitted by default."],
  [/^订单号 (.+) 在另一个未提交的批次里（(.+)，(\d{4}-\d\d-\d\d)），可能是重复导入，默认不提交$/, "Order ref $1 is in another unsubmitted batch ($2, $3). Possible duplicate — not submitted by default."],
  [/^所有渠道都无法报价：(.+)$/, "No service could quote: $1"],
  [/^处理出错：(.+)$/, "Processing error: $1"],
  [/^运费已更新为 ([\d.]+)，请确认后再提交$/, "Postage updated to $1. Please review before submitting."],
  [/^(\d+) 单运费有变化，请确认后再点“提交订单”$/, "Postage changed for $1 orders. Please review, then click “Submit orders”."],
  [/^已修改 (\d+) 单$/, "Updated $1 orders"],
  [/^(\d+) 单该渠道没有报价，保持原选择$/, "$1 orders have no rate from that service and kept their previous choice"],
  [/^已删除 (\d+) 单$/, "Deleted $1 orders"],
  // 寄件地址簿
  ...fillCombos,
  // 扣款记录说明
  [/^运费 · (.+)$/, "Postage · $1"],
  [/^账单补差 · (.+)$/, "Billing adjustment · $1"],
];
