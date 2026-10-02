import Link from "next/link";
import { notFound } from "next/navigation";
import ShipForm from "@/components/ShipForm";
import { requireCustomer } from "@/lib/auth";
import { getSettings, getShipment, reorderRef } from "@/lib/db";
import { listSenders } from "@/lib/senders";
import { getT } from "@/lib/prefs";

export const dynamic = "force-dynamic";

/** 已取消的订单重新下单：预填原单的地址、包裹、商品，订单号默认在原单号后面加 A / B… */
export default async function PortalReorderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string }> }) {
  const me = await requireCustomer();
  const s = getShipment(Number((await params).id));
  if (!s || s.customerId !== me.id) notFound();
  const t = await getT();
  const back = (await searchParams).back;
  const returnTo = back && back.startsWith("/portal") && !back.startsWith("//") && !back.includes("\\") ? back : undefined;
  if (s.status !== "cancelled" || s.replacedBy) {
    return (
      <>
        <h1>{t("重新下单")}</h1>
        <div className="alert warn">
          {s.replacedBy ? t("这张订单已经重新下过单了。") : t("只有已取消的订单可以重新下单。")}{" "}
          <Link href={`/portal/shipments/${s.replacedBy ?? s.id}`}>{s.replacedBy ? t("查看新单 →") : t("← 返回订单")}</Link>
        </div>
      </>
    );
  }
  const st = getSettings();
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{t("重新下单")} · {s.customerRef || s.customNo}</h1>
          <p className="small muted" style={{ margin: 0 }}>{t("原订单已取消。地址、包裹和商品已经填好，订单号默认在原单号后面加字母，可以修改后查询运费出单。")}</p>
        </div>
        <Link href={returnTo ?? `/portal/shipments/${s.id}`}>{returnTo ? t("← 返回批次") : t("← 返回订单")}</Link>
      </div>
      <ShipForm
        mode="portal"
        reorder={{ id: s.id, request: { sender: s.sender, recipient: s.recipient, pkg: s.pkg, skuList: s.skuList }, customerRef: reorderRef(me.id, s.customerRef), remark: s.remark, returnTo }}
        senders={listSenders(me.id)}
        defaultSender={st.sender}
        wallet={{ balance: me.balance, creditLimit: me.creditLimit, rule: st.balanceRule }}
        defaultUnit={s.pkg.displayUnitSystem}
        defaultCurrency={s.currency || st.defaultCurrency}
      />
    </>
  );
}
