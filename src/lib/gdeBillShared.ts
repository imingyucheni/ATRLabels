/** 嘉谷对账单：浏览器和服务器都要用的常量（不引用数据库） */
export type GdeKind = "base" | "extra" | "cancel";

export const GDE_KIND_LABEL: Record<GdeKind, string> = { base: "运费账单", extra: "补收", cancel: "取消退款" };

/** 费用明细列（嘉谷账单里“总金额”后面那些） */
export const GDE_FEES = [
  "运费", "燃油附加费", "签名费", "偏远费", "超偏远费", "超超偏远费", "住宅地址附加费", "私人地址-旺季附加费", "旺季附加费",
  "额外处理费-超重", "额外处理费-超尺寸", "非标准包装附加费", "额外处理费-旺季附加费", "超尺寸附加费", "超尺寸旺季附加费",
  "改地址服务费", "保险费", "退件费", "人工分拣费", "危险品附加费", "其他费",
];


/** 账单核对出来的问题类型（warn 的会进“嘉谷账单待核对”，处理完手动标记） */
export type GdeIssueType = "cancelled_charged" | "bill_changed" | "status_mismatch" | "refund_mismatch" | "not_found" | "channel" | "base_diff_off" | "legacy_dup";

export const GDE_ISSUE_LABEL: Record<GdeIssueType, string> = {
  cancelled_charged: "已取消仍被收费",
  bill_changed: "账单金额改过",
  status_mismatch: "状态对不上",
  refund_mismatch: "退款对不上",
  not_found: "系统里找不到",
  channel: "渠道对不上",
  base_diff_off: "运费差额未处理",
  legacy_dup: "已补过",
};
