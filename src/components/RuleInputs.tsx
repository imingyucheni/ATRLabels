import type { PartialRule } from "@/lib/pricing";

/** 加价规则输入框；留空表示沿用上一级设置。 */
export default function RuleInputs({
  prefix = "",
  value,
  placeholder,
}: {
  prefix?: string;
  value?: PartialRule;
  placeholder?: { percent?: string; fixed?: string; minProfit?: string };
}) {
  const v = (x: number | null | undefined) => (x === null || x === undefined ? "" : String(x));
  return (
    <>
      <label className="f">加价 %<input name={prefix + "percent"} type="number" step="0.01" min="0" defaultValue={v(value?.percent)} placeholder={placeholder?.percent} /></label>
      <label className="f">每单固定加价<input name={prefix + "fixed"} type="number" step="0.01" min="0" defaultValue={v(value?.fixed)} placeholder={placeholder?.fixed} /></label>
      <label className="f">每单最低利润<input name={prefix + "minProfit"} type="number" step="0.01" min="0" defaultValue={v(value?.minProfit)} placeholder={placeholder?.minProfit} /></label>
    </>
  );
}
