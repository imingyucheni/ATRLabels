import { fmtTime, TZ_LABEL } from "@/lib/time";
import { currentCustomerId } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { STATUS_LABEL } from "@/lib/db";
import { listOwnShipments } from "@/lib/portal";
import { getT } from "@/lib/prefs";

/** 表头首字母大写（中文不受影响） */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const UNIT: Record<number, string> = { 1: "g/cm", 2: "kg/cm", 3: "lb/in" };

/**
 * 客户导出自己的面单：默认是“上传的订单信息 + 下单时间、系统单号、运单号、渠道”，
 * 加 fees=1 才导出运费、取消手续费、退回和补差。不含成本。
 */
export async function GET(req: Request) {
  const me = await currentCustomerId();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const t = await getT();
  const p = new URL(req.url).searchParams;
  const fees = p.get("fees") === "1";
  const rows = listOwnShipments(me, { status: p.get("status") || undefined, from: p.get("from") || undefined, to: p.get("to") || undefined, q: p.get("q") || undefined });
  const join = (xs: (string | number | null | undefined)[]) => xs.filter((x) => x !== null && x !== undefined && x !== "").join("; ");

  const head = [
    "自定义单号", "__time", "系统单号", "运单号", "渠道", "状态",
    "收件联系人姓", "收件联系人名", "收件人联系电话", "收件国家", "收件省州", "收件市府", "收件邮编", "收件邮箱", "收件地址1", "收件地址2", "公司名称",
    "包裹长", "包裹宽", "包裹高", "包裹重量", "包裹单位",
    "SKU", "品名(英文)", "数量",
    "寄件联系人姓", "寄件联系人名", "寄件国家", "寄件省州", "寄件市府", "寄件邮编", "寄件地址1",
    "备注",
    ...(fees ? ["币种", "运费", "取消手续费", "退回", "补差"] : []),
  ].map((h) => (h === "__time" ? t("下单时间({tz})", { tz: t(TZ_LABEL) }) : cap(t(h))));

  return csvResponse(
    t("面单-{date}.csv", { date: new Date().toISOString().slice(0, 10) }),
    head,
    rows.map((s) => {
      const r = s.recipient;
      const f = s.sender;
      return [
        s.customerRef || s.customNo, fmtTime(s.createdAt), s.customNo, s.trackingNo, s.channelName, t(STATUS_LABEL[s.status]),
        r.nameLast, r.nameFirst, r.phone, r.country, r.province, r.city, r.zipCode, r.email, r.address1, r.address2, r.corporateName,
        s.pkg.length, s.pkg.width, s.pkg.height, s.pkg.weight, UNIT[s.pkg.displayUnitSystem] ?? "",
        join(s.skuList.map((x) => x.sku)), join(s.skuList.map((x) => x.productNameEn)), join(s.skuList.map((x) => x.quantity)),
        f.nameLast, f.nameFirst, f.country, f.province, f.city, f.zipCode, f.address1,
        s.remark,
        ...(fees ? [s.currency, s.price, s.cancelFee, s.refundAmount, s.adjustment || ""] : []),
      ];
    }),
  );
}
