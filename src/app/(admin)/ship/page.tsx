import Link from "next/link";
import ShipForm from "@/components/ShipForm";
import { getSettings, houseCustomerId, listChannels } from "@/lib/db";
import { getT } from "@/lib/prefs";
import { recentPackages, skuPresets } from "@/lib/portal";
import { redirect } from "next/navigation";
import { draftRows, getDraft, MAX_DRAFTS } from "@/lib/drafts";
import DraftList from "@/components/DraftList";

export const dynamic = "force-dynamic";

/** 管理员下单：记在“公司自用（成本价）”账户下，所有已启用渠道一起比价，按我们的成本出单 */
export default async function AdminShipPage({ searchParams }: { searchParams: Promise<{ draft?: string; n?: string }> }) {
  const t = await getT();
  const s = getSettings();
  const channels = listChannels(true);
  const houseId = houseCustomerId();
  const sp = await searchParams;
  const draft = getDraft(houseId, Number(sp.draft));
  if (draft?.intl) redirect(`/ship/intl?draft=${draft.id}`);
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{t("管理员下单")}</h1>
          <p className="small muted" style={{ margin: 0 }}>
            {t("按我们的成本价出单，所有已启用的渠道一起比价（包括多个 USPS、GOFO 等）。订单记在“公司自用（成本价）”账户下，不扣任何客户的余额。")}
          </p>
        </div>
        <div className="row">
          <Link className="btn" href="/ship/batch">{t("批量导入")}</Link>
          <Link className="btn" href={`/shipments?customerId=${houseId}`}>{t("我下的单")}</Link>
        </div>
      </div>
      {!channels.length && <div className="alert warn" style={{ marginTop: 12 }}>{t("没有启用的渠道，请先到")} <Link href="/settings#shipbest">{t("设置")}</Link> {t("同步渠道。")}</div>}
      <div style={{ height: 12 }} />
      <DraftList scope="house" drafts={draftRows(houseId, { us: "/ship", intl: "/ship/intl" })} currentId={draft?.id} max={MAX_DRAFTS} newHref={`/ship?n=${Date.now()}`} />
      <ShipForm key={draft ? `d${draft.id}` : `new${sp.n ?? ""}`} mode="house" draftScope="house" draft={draft ?? undefined} recentPackages={recentPackages(houseId)} skuPresets={skuPresets(houseId)} defaultSender={s.sender} defaultUnit={s.defaultUnit} defaultCurrency={s.defaultCurrency} />
    </>
  );
}
