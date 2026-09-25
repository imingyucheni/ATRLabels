import { listJobs } from "@/lib/batch";
import RecentJobs from "@/components/RecentJobs";
import { customerChannels, listCustomers } from "@/lib/db";
import BatchOrders from "@/components/BatchOrders";

export default async function AdminBatchPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job } = await searchParams;
  const jobs = listJobs(undefined, 20);
  return (
    <>
      <h1>批量下单</h1>
      <BatchOrders
        mode="admin"
        basePath="/shipments/batch"
        jobId={Number(job) || undefined}
        customers={listCustomers().map((c) => ({
          id: c.id,
          name: c.name,
          channels: customerChannels(c.id).map((ch) => ({ code: ch.code, name: ch.name })),
        }))}
      />
      <RecentJobs jobs={jobs} basePath="/shipments/batch" showCustomer />
    </>
  );
}
