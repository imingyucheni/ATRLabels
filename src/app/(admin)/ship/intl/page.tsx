import Link from "next/link";
import ShipForm from "@/components/ShipForm";
import { getSettings, houseCustomerId, listChannels } from "@/lib/db";
import { recentPackages, skuPresets } from "@/lib/portal";
import { dhlConfig, dhlSettings, isDhlCode } from "@/lib/shipbest/dhl";
import { getT } from "@/lib/prefs";
import { redirect } from "next/navigation";
import { draftRows, getDraft } from "@/lib/drafts";
import DraftList from "@/components/DraftList";
import { isMockMode } from "@/lib/shipbest/client";

export const dynamic = "force-dynamic";

/** 管理员国际下单：公司自用账户，按 DHL 成本价出单 */
export default async function AdminIntlShipPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const t = await getT();
  const s = getSettings();
  const d = dhlSettings();
  const channels = listChannels(true).filter((c) => isDhlCode(c.code));
  const houseId = houseCustomerId();
  const draft = getDraft(houseId, Number((await searchParams).draft));
  if (draft && !draft.intl) redirect(`/ship?draft=${draft.id}`);
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{t("国际下单（DHL）")}</h1>
          <p className="small muted" style={{ margin: 0 }}>
            {t("按我们的 DHL 成本价出单，订单记在“公司自用（成本价）”账户下，不扣任何客户的余额。")}
            {d.mode !== "live" && <> <b>{t("当前是 DHL 测试环境，不会真实出单。")}</b></>}
          </p>
        </div>
        <Link className="btn" href="/ship">{t("美国本地下单")}</Link>
      </div>
      {!dhlConfig() && !isMockMode() && <div className="alert warn" style={{ marginTop: 12 }}>{t("DHL 还没有启用或账号没填完整，请先到")} <Link href="/settings#dhl">{t("设置 → DHL Express")}</Link>{t("。")}</div>}
      {!channels.length && <div className="alert warn" style={{ marginTop: 12 }}>{t("还没有 DHL 渠道，请到")} <Link href="/settings#channels">{t("设置 → 物流渠道")}</Link> {t("点“同步渠道”。")}</div>}
      <div style={{ height: 12 }} />
      <DraftList scope="house" drafts={draftRows(houseId, { us: "/ship", intl: "/ship/intl" })} currentId={draft?.id} />
      <ShipForm key={draft ? `d${draft.id}` : "new"} mode="house" intl draftScope="house" draft={draft ?? undefined} recentPackages={recentPackages(houseCustomerId())} skuPresets={skuPresets(houseCustomerId())} defaultOrigin={d.originCountry} defaultSender={s.sender} defaultUnit={s.defaultUnit} defaultCurrency="USD" />
    </>
  );
}
