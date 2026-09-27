import Link from "next/link";
import BatchOrders from "@/components/BatchOrders";
import RecentJobs from "@/components/RecentJobs";
import { listJobs } from "@/lib/batch";
import { HOUSE_CUSTOMER_NAME, houseCustomerId, listChannels } from "@/lib/db";
import { getT } from "@/lib/prefs";

export const dynamic = "force-dynamic";

/** 管理员批量下单：公司自用账户，按成本价，所有已启用渠道一起比价 */
export default async function AdminBatchPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job } = await searchParams;
  const t = await getT();
  const houseId = houseCustomerId();
  const channels = listChannels(true).map((c) => ({ code: c.code, name: c.name }));
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{t("管理员批量下单")}</h1>
          <p className="small muted" style={{ margin: 0 }}>{t("上传表格批量出单：按我们的成本价，所有已启用的渠道逐单比价。订单记在“公司自用（成本价）”账户下，不扣任何客户的余额。")}</p>
        </div>
        <Link className="btn" href="/ship">{t("单个下单")}</Link>
      </div>
      <div style={{ height: 12 }} />
      <BatchOrders
        mode="house"
        basePath="/ship/batch"
        jobId={Number(job) || undefined}
        customers={[{ id: houseId, name: HOUSE_CUSTOMER_NAME, channels }]}
      />
      <RecentJobs jobs={listJobs(houseId, 20)} basePath="/ship/batch" />
    </>
  );
}
