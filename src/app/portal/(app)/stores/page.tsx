import { redirect } from "next/navigation";
import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { countStoreOrders, listStoreOrders, listStores, ebaySettings, storesEnabled, syncStaleStores, type StoreOrderStatus } from "@/lib/stores";
import { packagesBySkuCombo, recentPackages, skuComboKey } from "@/lib/portal";
import { packagesFromProducts } from "@/lib/products";
import { listSenders } from "@/lib/senders";
import { getSettings } from "@/lib/db";
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
  // 超过 5 分钟没同步就先同步一下，打开就是最新的订单
  await syncStaleStores(me.id);
  const stores = listStores(me.id);
  const rows = listStoreOrders(me.id, { status: tab });
  const c = countStoreOrders(me.id);
  const counts: Record<string, number> = { ...c, all: 0 };
  const ebayOn = ebaySettings().enabled || isMockMode();
  // 包裹自动带出：存过的常用产品优先，其次是以前发过同样商品组合的包裹
  const fromProducts = packagesFromProducts(me.id);
  const combos = new Map([...packagesBySkuCombo(me.id), ...fromProducts]);
  const comboOf = (items: { sku: string; name: string; quantity: number }[]) => skuComboKey(items.map((i) => ({ sku: i.sku || i.name.slice(0, 40) || "ITEM", quantity: i.quantity })));
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
        contact={getSettings().supportContact || undefined}
        stores={stores.map((s) => ({
          id: s.id, platform: s.platform, name: s.name, shop: s.shop, status: s.status, lastSync: s.lastSyncAt ? fmtTime(s.lastSyncAt) : null,
          lastError: s.lastError ? tMsg(s.lastError) : null, openCount: s.openCount, hasSecret: s.hasSecret, clientId: s.clientId, installUrl: s.installUrl,
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
        senders={listSenders(me.id).map((s) => ({ id: s.id, label: s.label, isDefault: s.isDefault }))}
        defaultUnit={getSettings().defaultUnit}
        rows={rows.map((r) => ({
          id: r.id, platform: r.platform, storeName: r.storeName, name: r.name, orderedAt: r.orderedAt ? fmtTime(r.orderedAt) : null,
          recipient: [[r.order.recipient.nameFirst, r.order.recipient.nameLast].filter(Boolean).join(" "), r.order.recipient.address1, `${r.order.recipient.city} ${r.order.recipient.province ?? ""} ${r.order.recipient.zipCode}${r.order.recipient.country !== "US" ? ` ${r.order.recipient.country}` : ""}`.trim()].filter(Boolean).join(", "),
          items: r.order.items.map((i) => `${i.sku || i.name} ×${i.quantity}`).join("、"),
          weightGrams: r.order.weightGrams, status: r.status, jobId: r.jobId, shipmentId: r.shipmentId, trackingNo: r.trackingNo, pushError: r.pushError, pushNote: r.pushNote, issue: r.order.issue, shippingMethod: r.order.shippingMethod ?? null, note: r.order.note ?? null, labelReady: !!r.trackingNo && r.shipmentStatus !== "cancelled" && r.shipmentStatus !== "pending", suggest: r.status === "open" ? combos.get(comboOf(r.order.items)) ?? null : null, suggestFromProduct: fromProducts.has(comboOf(r.order.items)),
        }))}
      />
        </>
      )}
    </>
  );
}
