import { isLoggedIn } from "@/lib/auth";
import { listShipments, shipmentProfit, STATUS_LABEL } from "@/lib/db";

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // 防止 Excel 公式注入
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET(req: Request) {
  if (!(await isLoggedIn())) return new Response("Unauthorized", { status: 401 });
  const p = new URL(req.url).searchParams;
  const rows = listShipments({
    customerId: Number(p.get("customerId")) || undefined,
    status: p.get("status") || undefined,
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
    q: p.get("q") || undefined,
  });
  const header = [
    "创建时间(UTC)", "客户", "自定义单号", "ShipBest单号", "运单号", "渠道", "状态",
    "收件人", "收件国家", "收件邮编", "币种", "试算成本", "实扣成本", "客户价", "取消手续费", "ShipBest取消费", "退款", "利润",
  ];
  const lines = rows.map((s) =>
    [
      s.createdAt, s.customerName, s.customNo, s.orderNo, s.trackingNo, s.channelName, STATUS_LABEL[s.status],
      `${s.recipient.nameFirst} ${s.recipient.nameLast}`, s.recipient.country, s.recipient.zipCode, s.currency,
      s.quotedCost, s.actualCost, s.price, s.cancelFee, s.sbCancelFee, s.refundAmount, shipmentProfit(s)?.toFixed(2),
    ].map(csvCell).join(","),
  );
  // 加 BOM，Excel 打开中文不乱码
  const body = "﻿" + [header.join(","), ...lines].join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="shipments-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
