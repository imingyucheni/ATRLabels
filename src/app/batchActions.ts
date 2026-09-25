"use server";

import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { readSheetRows } from "@/lib/adjustments";
import {
  chooseAll,
  deleteRows,
  chooseRowChannel,
  confirmJob,
  createJob,
  deleteJob,
  ensureRunning,
  getJob,
  parseOrders,
  requote,
  senderFor,
  setSelected,
  type BatchJob,
} from "@/lib/batch";
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
    const channels = fd.getAll("channels").map((v) => str(v, 50)).filter(Boolean);
    const { orders, error } = parseOrders(rows, senderFor(customerId));
    if (error) return { error };
    const jobId = createJob({
      customerId,
      createdBy: a.admin ? "admin" : "customer",
      filename: str(file.name, 200),
      channels,
      pickMode: fd.get("pickMode") === "file" ? "file" : "cheapest",
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
          rows: job.rows.map((r) => ({
            ...r,
            error: r.error ? publicError(r.error) : null,
            quotes: r.quotes.map((q) => (q.error ? { ...q, error: publicError(q.error) } : q)),
          })),
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

async function edit(jobId: number, fn: () => unknown): Promise<{ error?: string; message?: string }> {
  try {
    await ownJob(jobId);
    const r = fn();
    return typeof r === "string" ? { message: r } : {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** 单独给某一单选渠道 */
export async function chooseRowAction(jobId: number, rowId: number, code: string) {
  return edit(jobId, () => chooseRowChannel(jobId, rowId, str(code, 50)));
}

/** 批量选渠道：cheapest 最便宜 / file 按表格 / 渠道代码；rowIds 为空表示全部 */
export async function chooseAllAction(jobId: number, rule: string, rowIds?: number[]) {
  return edit(jobId, () => {
    const r = chooseAll(jobId, str(rule, 50), rowIds?.map(Number));
    return r.skipped ? `已修改 ${r.changed} 单；${r.skipped} 单该渠道没有报价，保持原选择` : `已修改 ${r.changed} 单`;
  });
}

export async function setSelectedAction(jobId: number, rowIds: number[] | "all" | "none") {
  return edit(jobId, () => setSelected(jobId, Array.isArray(rowIds) ? rowIds.map(Number) : rowIds));
}

export async function deleteRowsAction(jobId: number, rowIds: number[]) {
  return edit(jobId, () => `已删除 ${deleteRows(jobId, rowIds.map(Number))} 单`);
}

export async function requoteAction(jobId: number, channels: string[]) {
  return edit(jobId, () => requote(jobId, channels.map((c) => str(c, 50))));
}
