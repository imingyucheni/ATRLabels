import { money } from "@/lib/pricing";

export default function Profit({ value, currency }: { value: number | null; currency?: string }) {
  if (value === null) return <span className="muted">-</span>;
  return <span className={value >= 0 ? "profit-pos" : "profit-neg"}>{money(value, currency)}</span>;
}
