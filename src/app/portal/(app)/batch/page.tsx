import { requireCustomer } from "@/lib/auth";
import { listJobs } from "@/lib/batch";
import { customerChannels } from "@/lib/db";
import BatchOrders from "@/components/BatchOrders";
import RecentJobs from "@/components/RecentJobs";
import { getT } from "@/lib/prefs";

export default async function PortalBatchPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const me = await requireCustomer();
  const { job } = await searchParams;
  const t = await getT();
  return (
    <>
      <h1>{t("批量下单")}</h1>
      {!me.sender && <p className="small muted">{t("表格里没填寄件人的订单，会使用系统默认寄件地址；也可以在“账户设置”里设置自己的默认寄件地址。")}</p>}
      <BatchOrders
        mode="portal"
        basePath="/portal/batch"
        jobId={Number(job) || undefined}
        channels={customerChannels(me.id).map((c) => ({ code: c.code, name: c.name }))}
      />
      <RecentJobs jobs={listJobs(me.id, 20)} basePath="/portal/batch" />
    </>
  );
}
