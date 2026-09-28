import Link from "next/link";
import { notFound } from "next/navigation";
import ShipForm from "@/components/ShipForm";
import { getSettings, getShipment, isInternalCustomer } from "@/lib/db";
import { listProviderEvents } from "@/lib/providerLog";
import { fmtTime } from "@/lib/time";
import { getLang } from "@/lib/prefs";
import { makeT, translateMessage } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/** 异常单修改后重新下单：表单预填原订单的信息，改好体积、重量等再比价出单 */
export default async function ResubmitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string }> }) {
  const s = getShipment(Number((await params).id));
  // 从批量下单页过来的：出单后回到那个批次（只接受站内地址）
  const back = (await searchParams).back;
  const returnTo = back && back.startsWith("/") && !back.startsWith("//") && !back.includes("\\") ? back : undefined;
  if (!s) notFound();
  const lang = await getLang();
  const t = makeT(lang);
  const tm = (m: string | null) => (m ? m.split("；").map((x) => translateMessage(lang, x)).join(t("；")) : m);
  const settings = getSettings();
  // 服务商最近一次“不是成功”的返回，通常就是异常原因
  const last = listProviderEvents(s.customNo).filter((e) => e.provider !== "系统" && !/^成功/.test(e.message)).slice(-1)[0];

  if (s.status !== "exception" || s.replacedBy) {
    return (
      <>
        <h1>{t("修改后重新下单")}</h1>
        <div className="alert warn">
          {s.replacedBy ? t("这张订单已经修改后重新下过单了。") : t("只有出单异常的订单可以修改后重新下单。")}{" "}
          <Link href={`/shipments/${s.replacedBy ?? s.id}`}>{s.replacedBy ? t("查看新单 →") : t("← 返回订单")}</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{t("修改后重新下单")} · {s.customerRef || s.customNo}</h1>
          <p className="small muted" style={{ margin: 0 }}>
            {t("原订单的地址、包裹和商品已经填好。改好尺寸、重量等信息后重新查询运费出单（也可以换渠道）。新单出单成功后，原异常单会自动取消，费用退回。")}
          </p>
        </div>
        <Link href={returnTo ?? `/shipments/${s.id}`}>{returnTo ? t("← 返回批次") : t("← 返回订单")}</Link>
      </div>
      <div className="alert err">
        <b>{t("原订单异常")}</b>{t("：")}{tm(s.errorMsg) || t("服务商没有返回具体原因")}
        {last && <div className="small" style={{ marginTop: 4 }}>{t("服务商最近一次返回（{time}）", { time: fmtTime(last.lastAt) })}{t("：")}{t(last.action)} · {last.code ? `[${last.code}] ` : ""}{last.message}</div>}
      </div>
      <ShipForm
        mode="resubmit"
        resubmit={{
          id: s.id,
          customerName: s.customerName ?? "",
          house: isInternalCustomer(s.customerId),
          channelCode: s.channelCode,
          request: { sender: s.sender, recipient: s.recipient, pkg: s.pkg, skuList: s.skuList },
          remark: s.remark,
          customerRef: s.customerRef,
          returnTo,
        }}
        defaultSender={s.sender}
        defaultUnit={s.pkg.displayUnitSystem}
        defaultCurrency={s.currency || settings.defaultCurrency}
      />
    </>
  );
}
