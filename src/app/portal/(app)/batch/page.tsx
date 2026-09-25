import { requireCustomer } from "@/lib/auth";
import { listJobs } from "@/lib/batch";
import { listChannels } from "@/lib/db";
import BatchOrders from "@/components/BatchOrders";
import RecentJobs from "@/components/RecentJobs";

export default async function PortalBatchPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const me = await requireCustomer();
  const { job } = await searchParams;
  return (
    <>
      <h1>批量下单</h1>
      {!me.sender && <div className="alert warn">还没有设置默认寄件地址，批量下单会使用系统默认寄件地址。可以在“账户设置”里修改。</div>}
      <BatchOrders
        mode="portal"
        basePath="/portal/batch"
        jobId={Number(job) || undefined}
        channels={listChannels(true).map((c) => ({ code: c.code, name: c.name }))}
      />
      <RecentJobs jobs={listJobs(me.id, 20)} basePath="/portal/batch" />
    </>
  );
}
