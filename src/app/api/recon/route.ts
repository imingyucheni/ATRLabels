import { isLoggedIn } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { localDate } from "@/lib/reports";
import { STATUS_LABEL } from "@/lib/db";
import { buildRecon, localDay, postageOf, PROVIDERS, providerKeyOf, reconAdjustments, reconChannelName, reconShipments, type ProviderKey } from "@/lib/providerRecon";
import { jgOrders } from "@/lib/shipbest/jiagu";
import { fmtTime } from "@/lib/time";
import { getT } from "@/lib/prefs";

const UNIT = { 1: "g", 2: "kg", 3: "lb" } as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** 服务商对账导出：渠道汇总 / 订单明细 / 补差明细（CSV，Excel 可直接打开） */
export async function GET(req: Request) {
  if (!(await isLoggedIn())) return new Response("Unauthorized", { status: 401 });
  const t = await getT();
  const h = (k: string) => cap(t(k));
  const p = new URL(req.url).searchParams;
  let to = p.get("to") || localDate();
  let from = p.get("from") || to;
  if (from > to) [from, to] = [to, from];
  const provider = PROVIDERS.find((x) => x.key === p.get("provider"))?.key as ProviderKey | undefined;
  const pName = (key: ProviderKey) => PROVIDERS.find((x) => x.key === key)!.tag;
  const tag = provider ? `${pName(provider)}-` : "";
  const type = p.get("type");

  if (type === "lines") {
    const rows = reconShipments(from, to, provider).map((s) => {
      const key = providerKeyOf(s.channelCode);
      const providerNo = key === "jiagu" ? jgOrders.get(s.customNo)?.identifier ?? "" : s.orderNo ?? "";
      const postage = s.status === "cancelled" || s.status === "exception" ? 0 : postageOf(s);
      const cancelFee = s.status === "cancelled" ? s.sbCancelFee ?? 0 : 0;
      return [
        fmtTime(s.createdAt), pName(key), reconChannelName(s.channelCode, s.channelName), s.channelCode, s.customerRef ?? "", s.customNo, providerNo, s.trackingNo ?? "",
        s.customerName ?? "", s.zone ?? "", `${s.pkg.weight} ${UNIT[s.pkg.displayUnitSystem]}`, t(STATUS_LABEL[s.status]),
        s.status === "exception" ? `${t("未计入")} ${postageOf(s)}` : postage, cancelFee, s.costAdj || "", Math.round((postage + cancelFee) * 100) / 100,
      ];
    });
    return csvResponse(`${tag}${t("对账明细-{from}_{to}.csv", { from, to })}`,
      ["下单时间", "服务商", "渠道", "渠道代码", "自定义单号", "系统单号", "服务商单号", "运单号", "客户", "分区", "重量", "状态", "邮费", "取消费", "该单累计补差", "本单应付（不含补差）"].map(h), rows);
  }

  if (type === "adjustments") {
    const rows = reconAdjustments(from, to)
      .filter((a) => a.channelCode && (!provider || providerKeyOf(a.channelCode) === provider))
      .map((a) => [localDay(a.createdAt), pName(providerKeyOf(a.channelCode!)), reconChannelName(a.channelCode!, a.channelName), a.customerRef ?? "", a.customNo ?? "", a.trackingNo ?? a.matchKey, a.amount, a.reason ?? "", a.batchFilename]);
    return csvResponse(`${tag}${t("补差明细-{from}_{to}.csv", { from, to })}`,
      ["导入日期", "服务商", "渠道", "自定义单号", "系统单号", "运单号", "补差金额", "原因", "导入文件"].map(h), rows);
  }

  // 渠道汇总
  const r = buildRecon(from, to);
  const rows = r.providers
    .filter((x) => !provider || x.key === provider)
    .flatMap((x) => [
      ...x.channels.map((c) => [x.tag, c.name, c.code, c.labels, c.postage, c.labels ? Math.round((c.postage / c.labels) * 100) / 100 : "", c.cancelled, c.cancelFees, c.adjustments, c.total]),
      [x.tag, t("合计"), "", x.totals.labels, x.totals.postage, x.totals.labels ? Math.round((x.totals.postage / x.totals.labels) * 100) / 100 : "", x.totals.cancelled, x.totals.cancelFees, x.totals.adjustments, x.totals.total],
    ]);
  return csvResponse(`${tag}${t("对账渠道汇总-{from}_{to}.csv", { from, to })}`,
    ["服务商", "渠道", "渠道代码", "出单数", "邮费", "单均邮费", "取消单", "取消费", "补差", "应付合计"].map(h), rows);
}
