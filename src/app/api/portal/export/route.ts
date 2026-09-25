import { fmtTime, TZ_LABEL } from "@/lib/time";
import { currentCustomerId } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { STATUS_LABEL } from "@/lib/db";
import { listOwnShipments } from "@/lib/portal";
import { getT } from "@/lib/prefs";

/** 表头首字母大写（中文不受影响） */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** 客户导出自己的面单（不含成本） */
export async function GET(req: Request) {
  const me = await currentCustomerId();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const t = await getT();
  const p = new URL(req.url).searchParams;
  const rows = listOwnShipments(me, { status: p.get("status") || undefined, from: p.get("from") || undefined, to: p.get("to") || undefined, q: p.get("q") || undefined });
  return csvResponse(
    t("面单-{date}.csv", { date: new Date().toISOString().slice(0, 10) }),
    [t("下单时间({tz})", { tz: t(TZ_LABEL) }), ...["我的订单号", "系统单号", "运单号", "渠道", "分区", "状态", "收件人", "城市", "州", "邮编", "国家", "币种", "运费", "取消手续费", "退回", "补差"].map((h) => cap(t(h)))],
    rows.map((s) => [
      fmtTime(s.createdAt), s.customerRef, s.customNo, s.trackingNo, s.channelName, s.zone, t(STATUS_LABEL[s.status]),
      `${s.recipient.nameFirst} ${s.recipient.nameLast}`, s.recipient.city, s.recipient.province, s.recipient.zipCode, s.recipient.country,
      s.currency, s.price, s.cancelFee, s.refundAmount, s.adjustment || "",
    ]),
  );
}
