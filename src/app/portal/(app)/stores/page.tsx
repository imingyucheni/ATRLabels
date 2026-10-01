import { redirect } from "next/navigation";
import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { listStoreOrders, listStores, ebaySettings, storesEnabled, type StoreOrderStatus } from "@/lib/stores";
import { recentPackages } from "@/lib/portal";
import { isMockMode } from "@/lib/shipbest/client";
import { fmtTime } from "@/lib/time";
import { headers } from "next/headers";
import StoreOrders from "@/components/StoreOrders";
import StoreConnect from "@/components/StoreConnect";
import { publicBase } from "@/lib/stores/web";
import { getLang, getT } from "@/lib/prefs";
import { translateMessage } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const TABS: [StoreOrderStatus | "all", string][] = [["open", "待处理"], ["imported", "已导入"], ["shipped", "已发货"], ["closed", "已关闭"], ["all", "全部"]];

/** 店铺订单：Shopify / eBay 的未发货订单同步过来，勾选导入批量下单，出单后运单号自动回传店铺 */
export default async function PortalStoresPage({ searchParams }: { searchParams: Promise<{ status?: string; connected?: string; denied?: string }> }) {
  const me = await requireCustomer();
  if (!storesEnabled(me.id)) redirect("/portal");
  const t = await getT();
  const sp = await searchParams;
  const tab = (TABS.find(([k]) => k === sp.status)?.[0] ?? "open") as StoreOrderStatus | "all";
  const stores = listStores(me.id);
  const rows = listStoreOrders(me.id, { status: tab });
  const counts = Object.fromEntries(TABS.map(([k]) => [k, k === "all" ? 0 : listStoreOrders(me.id, { status: k }).length]));
  const ebayOn = ebaySettings().enabled || isMockMode();
  const lang = await getLang();
  const tMsg = (m: string) => translateMessage(lang, m);
  return (
    <>
      <h1>{t("店铺订单")}</h1>
      <p className="muted">{t("连接 Shopify / eBay 店铺后，未发货订单自动同步过来；勾选导入下单，出单后运单号自动回传店铺。")}</p>
      {sp.connected && <div className="alert ok">{t("{p} 店铺已连接，未发货的订单已经同步过来。", { p: sp.connected === "ebay" ? "eBay" : "Shopify" })}</div>}
      {sp.denied && <div className="alert warn">{t("你在 eBay 页面取消了授权，店铺没有连接。")}</div>}

      <StoreConnect
        base={publicBase({ headers: await headers() })}
        ebayOn={ebayOn}
        mock={isMockMode()}
        stores={stores.map((s) => ({
          id: s.id, platform: s.platform, name: s.name, shop: s.shop, status: s.status, lastSync: s.lastSyncAt ? fmtTime(s.lastSyncAt) : null,
          lastError: s.lastError ? tMsg(s.lastError) : null, openCount: s.openCount, hasSecret: s.hasSecret, clientId: s.clientId,
        }))}
      />

      {stores.length > 0 && (
        <>
      <div className="seg" style={{ margin: "4px 0 12px" }}>
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/portal/stores?status=${k}`} className={k === tab ? "on" : ""}>{t(label)}{k !== "all" && counts[k] ? ` (${counts[k]})` : ""}</Link>
        ))}
      </div>

      <StoreOrders
        key={tab}
        presets={recentPackages(me.id)}
        rows={rows.map((r) => ({
          id: r.id, platform: r.platform, storeName: r.storeName, name: r.name, orderedAt: r.orderedAt,
          recipient: [[r.order.recipient.nameFirst, r.order.recipient.nameLast].filter(Boolean).join(" "), r.order.recipient.address1, `${r.order.recipient.city} ${r.order.recipient.province ?? ""} ${r.order.recipient.zipCode}${r.order.recipient.country !== "US" ? ` ${r.order.recipient.country}` : ""}`.trim()].filter(Boolean).join(", "),
          items: r.order.items.map((i) => `${i.sku || i.name} ×${i.quantity}`).join("、"),
          weightGrams: r.order.weightGrams, status: r.status, jobId: r.jobId, shipmentId: r.shipmentId, trackingNo: r.trackingNo, pushError: r.pushError, issue: r.order.issue,
        }))}
      />
        </>
      )}
    </>
  );
}
