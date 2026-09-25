import { fmtTime, TZ_LABEL } from "@/lib/time";
import { isLoggedIn } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { LEDGER_TYPE_LABEL, listLedger } from "@/lib/ledger";
import { getLang, getT } from "@/lib/prefs";
import { translateMessage } from "@/lib/i18n";

/** 表头首字母大写（中文不受影响） */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function GET(req: Request) {
  if (!(await isLoggedIn())) return new Response("Unauthorized", { status: 401 });
  const t = await getT();
  const lang = await getLang();
  // 说明可能是“a · b”拼起来的，逐段翻译（中文原样）
  const note = (s: string | null) => (s ? s.split(" · ").map((x) => translateMessage(lang, x)).join(" · ") : s);
  const p = new URL(req.url).searchParams;
  const rows = listLedger({ from: p.get("from") || undefined, to: p.get("to") || undefined, customerId: Number(p.get("customerId")) || undefined });
  return csvResponse(
    t("流水-{date}.csv", { date: new Date().toISOString().slice(0, 10) }),
    [t("时间({tz})", { tz: t(TZ_LABEL) }), ...["客户", "类型", "单号", "运单号", "说明", "操作人", "金额"].map((h) => cap(t(h)))],
    rows.map((l) => [fmtTime(l.createdAt), l.customerName, t(LEDGER_TYPE_LABEL[l.type]), l.customNo, l.trackingNo, note(l.note), l.createdBy, l.amount.toFixed(2)]),
  );
}
