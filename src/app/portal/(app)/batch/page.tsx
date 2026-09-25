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
      {!me.sender && <p className="small muted">{t("表格里每一单都要填寄件人；也可以先在“账户设置 → 寄件地址簿”里设置默认寄件地址，下载的模版会自动填好。")}</p>}
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
