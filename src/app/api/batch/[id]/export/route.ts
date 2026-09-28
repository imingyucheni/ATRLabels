import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { getJob, jobExportRows } from "@/lib/batch";
import { csvResponse } from "@/lib/csv";
import { isInternalCustomer, STATUS_LABEL } from "@/lib/db";
import { displayChannel } from "@/lib/channelDisplay";
import { publicError } from "@/lib/portal";
import { isJiaguCode, jgOrders } from "@/lib/shipbest/jiagu";
import { fmtTime } from "@/lib/time";
import { getT } from "@/lib/prefs";

const TEXT = { "Content-Type": "text/plain; charset=utf-8" };
const UNIT: Record<number, string> = { 1: "g/cm", 2: "kg/cm", 3: "lb/in" };
const ROW_LABEL: Record<string, string> = { pending: "试算中", quoted: "待提交", error: "有错误", created: "已下单", failed: "下单失败" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * 批次数据导出（CSV）：导入的订单信息 + 下单结果（运单号、渠道、运费）。
 * 客户只能导出自己看得到的内容：不含服务商、成本、渠道代码，渠道用对外名称。
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const job = getJob(Number((await ctx.params).id));
  const admin = await isLoggedIn();
  if (!admin) {
    const own = await currentCustomerId();
    if (!own) return new Response("Unauthorized", { status: 401 });
    if (!job || job.customerId !== own) return new Response(t("任务不存在"), { status: 404, headers: TEXT });
  }
  if (!job) return new Response(t("任务不存在"), { status: 404, headers: TEXT });
  const house = isInternalCustomer(job.customerId);
  const join = (xs: (string | number | null | undefined)[]) => xs.filter((x) => x !== null && x !== undefined && x !== "").join("; ");

  const head = [
    "行", "自定义单号", "状态", "运单号", "渠道",
    // 公司自用（成本价）的批次：只要打单信息；客户的批次后台多看服务商和成本；客户自己只看运费
    ...(house ? [] : admin ? ["服务商", "服务商单号", "系统单号", "渠道代码", "客户价", "成本"] : ["运费"]),
    "问题",
    "收件联系人姓", "收件联系人名", "收件人联系电话", "收件国家", "收件省州", "收件市府", "收件邮编", "收件地址1", "收件地址2", "公司名称",
    "包裹长", "包裹宽", "包裹高", "包裹重量", "包裹单位", "SKU", "品名(英文)", "数量", "下单时间",
  ].map((h) => cap(t(h)));

  const rows = jobExportRows(job.id).map((r) => {
    const s = r.shipment;
    const code = s?.channelCode ?? r.channelCode;
    const status = s && s.status !== "labeled" ? t(STATUS_LABEL[s.status]) : t(ROW_LABEL[r.status] ?? r.status);
    const problem = s?.status === "exception" ? s.errorMsg : r.status === "error" || r.status === "failed" ? r.error : null;
    const rc = r.req.recipient;
    const price = s ? (s.status === "cancelled" ? "" : s.price) : r.price ?? "";
    return [
      r.rowNo, r.customerRef ?? "", status, s?.trackingNo ?? "",
      admin ? s?.channelName ?? r.channelName ?? "" : code ? displayChannel(code).name : "",
      ...(house
        ? []
        : admin
          ? [code ? (isJiaguCode(code) ? "GDE" : "SB") : "", s ? (isJiaguCode(s.channelCode) ? jgOrders.get(s.customNo)?.identifier ?? "" : s.orderNo ?? "") : "", s?.customNo ?? "", code ?? "", price, s ? s.actualCost ?? s.quotedCost : ""]
          : [price]),
      problem ? (admin ? problem : publicError(problem)) : "",
      rc.nameLast, rc.nameFirst, rc.phone, rc.country, rc.province, rc.city, rc.zipCode, rc.address1, rc.address2, rc.corporateName,
      r.req.pkg.length, r.req.pkg.width, r.req.pkg.height, r.req.pkg.weight, UNIT[r.req.pkg.displayUnitSystem] ?? "",
      join(r.req.skuList.map((x) => x.sku)), join(r.req.skuList.map((x) => x.productNameEn)), join(r.req.skuList.map((x) => x.quantity)),
      s ? fmtTime(s.createdAt) : "",
    ];
  });
  const base = (job.filename ?? "").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
  return csvResponse(`${t("批次")}${job.id}-${base}.csv`, head, rows);
}
