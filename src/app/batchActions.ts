"use server";

import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { readSheetRows } from "@/lib/adjustments";
import { confirmJob, createJob, deleteJob, ensureRunning, getJob, parseOrders, senderFor, type BatchJob } from "@/lib/batch";
import { getCustomer } from "@/lib/db";
import { publicError } from "@/lib/portal";
import { str } from "@/lib/sanitize";

/** 后台可以操作任意客户；客户只能操作自己的任务 */
async function actor(): Promise<{ admin: true } | { admin: false; customerId: number }> {
  if (await isLoggedIn()) return { admin: true };
  const id = await currentCustomerId();
  if (!id) throw new Error("请先登录");
  return { admin: false, customerId: id };
}

async function ownJob(jobId: number) {
  const a = await actor();
  const job = getJob(jobId);
  if (!job || (!a.admin && job.customerId !== a.customerId)) throw new Error("任务不存在");
  return { a, job };
}

export async function createBatchJobAction(fd: FormData): Promise<{ jobId?: number; error?: string }> {
  try {
    const a = await actor();
    const customerId = a.admin ? Number(fd.get("customerId")) : a.customerId;
    if (!getCustomer(customerId)) return { error: "请选择客户" };
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) return { error: "请选择文件" };
    if (file.size > 10 * 1024 * 1024) return { error: "文件不能超过 10MB" };
    const rows = await readSheetRows(file.name, Buffer.from(await file.arrayBuffer()), "first");
    const { orders, error } = parseOrders(rows, senderFor(customerId));
    if (error) return { error };
    const jobId = createJob({
      customerId,
      createdBy: a.admin ? "admin" : "customer",
      filename: str(file.name, 200),
      channelMode: str(fd.get("channelMode"), 50) || "cheapest",
      orders,
    });
    ensureRunning(jobId);
    return { jobId };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export interface BatchJobView extends BatchJob {
  balance: number;
  available: number;
}

export async function getBatchJobAction(jobId: number): Promise<{ job?: BatchJobView; error?: string }> {
  try {
    const { a, job } = await ownJob(jobId);
    // 服务重启后自动继续未完成的任务
    ensureRunning(jobId);
    const c = getCustomer(job.customerId)!;
    // 客户看到的报错去掉内部信息（钱包余额不足是客户自己的，保留）
    const view = a.admin
      ? job
      : {
          ...job,
          error: job.error && !job.error.startsWith("余额不足") ? publicError(job.error) : job.error,
          rows: job.rows.map((r) => ({ ...r, error: r.error ? publicError(r.error) : null })),
        };
    return { job: { ...view, balance: c.balance, available: c.balance + c.creditLimit } };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function confirmBatchJobAction(jobId: number): Promise<{ error?: string }> {
  try {
    await ownJob(jobId);
    confirmJob(jobId);
    return {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteBatchJobAction(jobId: number): Promise<{ error?: string }> {
  try {
    await ownJob(jobId);
    deleteJob(jobId);
    return {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}
