/**
 * 客户充值申请：客户转账后提交申请（Zelle 美元 / 支付宝人民币），后台确认后记入钱包。
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir, db, getCustomer } from "./db";
import { cnyToPay, usdCnyQuote } from "./fx";
import { sniffMime } from "./labels";
import { addLedger } from "./ledger";

export type TopupMethod = "zelle" | "alipay";
export type TopupStatus = "pending" | "approved" | "rejected";

export const TOPUP_METHOD_LABEL: Record<TopupMethod, string> = { zelle: "Zelle（美元）", alipay: "支付宝（人民币）" };
export const TOPUP_STATUS_LABEL: Record<TopupStatus, string> = { pending: "待确认", approved: "已到账", rejected: "未通过" };

export interface TopupRequest {
  id: number;
  customerId: number;
  customerName: string;
  method: TopupMethod;
  amountUsd: number;
  payAmount: number;
  payCurrency: string;
  fxLive: number | null;
  fxRate: number | null;
  reference: string | null;
  hasProof: boolean;
  proofMime: string | null;
  note: string | null;
  status: TopupStatus;
  creditedUsd: number | null;
  adminNote: string | null;
  createdAt: string;
  handledAt: string | null;
}

interface Row {
  id: number; customer_id: number; customer_name: string; method: TopupMethod; amount_usd: number; pay_amount: number; pay_currency: string;
  fx_live: number | null; fx_rate: number | null; reference: string | null; proof_path: string | null; proof_mime: string | null; note: string | null;
  status: TopupStatus; credited_usd: number | null; admin_note: string | null; created_at: string; handled_at: string | null;
}

const toReq = (r: Row): TopupRequest => ({
  id: r.id, customerId: r.customer_id, customerName: r.customer_name, method: r.method, amountUsd: r.amount_usd, payAmount: r.pay_amount,
  payCurrency: r.pay_currency, fxLive: r.fx_live, fxRate: r.fx_rate, reference: r.reference, hasProof: !!r.proof_path, proofMime: r.proof_mime,
  note: r.note, status: r.status, creditedUsd: r.credited_usd, adminNote: r.admin_note, createdAt: r.created_at, handledAt: r.handled_at,
});

function dir(sub: string) {
  const d = path.join(dataDir(), sub);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function checkImage(buf: Buffer) {
  const { mime, ext } = sniffMime(buf, null);
  if (!["image/png", "image/jpeg", "application/pdf"].includes(mime)) throw new Error("凭证请上传 PNG、JPG 截图或 PDF");
  return { mime, ext };
}

export async function createTopup(input: {
  customerId: number;
  method: TopupMethod;
  amountUsd: number;
  reference?: string;
  note?: string;
  proof?: Buffer | null;
}): Promise<number> {
  if (!getCustomer(input.customerId)) throw new Error("客户不存在");
  const amount = Math.round(input.amountUsd * 100) / 100;
  if (!(amount >= 1) || amount > 100000) throw new Error("充值金额请填写 1 到 100000 美元");
  let payAmount = amount;
  let payCurrency = "USD";
  let fxLive: number | null = null;
  let fxRate: number | null = null;
  if (input.method === "alipay") {
    // 服务器按当前汇率重新计算应付人民币，不信任页面传来的金额
    const q = await usdCnyQuote();
    fxLive = q.live;
    fxRate = q.rate;
    payAmount = cnyToPay(amount, q.rate);
    payCurrency = "CNY";
  }
  const proof = input.proof?.length ? { buf: input.proof, ...checkImage(input.proof) } : null;
  const r = db()
    .prepare(
      `INSERT INTO topup_requests (customer_id, method, amount_usd, pay_amount, pay_currency, fx_live, fx_rate, reference, note, proof_mime)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(input.customerId, input.method, amount, payAmount, payCurrency, fxLive, fxRate, input.reference || null, input.note || null, proof?.mime ?? null);
  const id = Number(r.lastInsertRowid);
  if (proof) {
    const rel = path.join("topup", `${id}.${proof.ext}`);
    fs.writeFileSync(path.join(dir("topup"), `${id}.${proof.ext}`), proof.buf);
    db().prepare("UPDATE topup_requests SET proof_path = ? WHERE id = ?").run(rel, id);
  }
  return id;
}

const SELECT = "SELECT t.*, c.name AS customer_name FROM topup_requests t JOIN customers c ON c.id = t.customer_id";

export function listTopups(f: { customerId?: number; status?: TopupStatus; limit?: number } = {}): TopupRequest[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.customerId) {
    where.push("t.customer_id = ?");
    args.push(f.customerId);
  }
  if (f.status) {
    where.push("t.status = ?");
    args.push(f.status);
  }
  return (db().prepare(`${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY t.id DESC LIMIT ${Number(f.limit ?? 200)}`).all(...args) as Row[]).map(toReq);
}

export function getTopup(id: number): TopupRequest | null {
  const r = db().prepare(`${SELECT} WHERE t.id = ?`).get(id) as Row | undefined;
  return r ? toReq(r) : null;
}

export function pendingTopupCount(): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM topup_requests WHERE status = 'pending'").get() as { n: number }).n;
}

export function readTopupProof(id: number): { buf: Buffer; mime: string } | null {
  const r = db().prepare("SELECT proof_path, proof_mime FROM topup_requests WHERE id = ?").get(id) as { proof_path: string | null; proof_mime: string | null } | undefined;
  if (!r?.proof_path) return null;
  return { buf: fs.readFileSync(path.join(dataDir(), r.proof_path)), mime: r.proof_mime ?? "application/octet-stream" };
}

/** 确认到账：按实际到账金额（美元）记入钱包 */
export function approveTopup(id: number, creditedUsd: number, adminNote: string | null) {
  const t = getTopup(id);
  if (!t) throw new Error("申请不存在");
  if (t.status !== "pending") throw new Error("这笔申请已经处理过了");
  const amount = Math.round(creditedUsd * 100) / 100;
  if (!(amount > 0)) throw new Error("入账金额必须大于 0");
  db().transaction(() => {
    const pay = t.payCurrency === "CNY" ? `支付宝 ¥${t.payAmount.toFixed(2)}（汇率 ${t.fxRate}）` : `Zelle $${t.payAmount.toFixed(2)}`;
    const ledgerId = addLedger({
      customerId: t.customerId,
      type: "topup",
      amount,
      note: `充值申请 #${t.id} · ${pay}${t.reference ? ` · 参考号 ${t.reference}` : ""}`,
      createdBy: "admin",
    });
    db()
      .prepare("UPDATE topup_requests SET status = 'approved', credited_usd = ?, admin_note = ?, ledger_id = ?, handled_at = datetime('now') WHERE id = ? AND status = 'pending'")
      .run(amount, adminNote, ledgerId, id);
  })();
}

export function rejectTopup(id: number, adminNote: string) {
  const t = getTopup(id);
  if (!t) throw new Error("申请不存在");
  if (t.status !== "pending") throw new Error("这笔申请已经处理过了");
  if (!adminNote.trim()) throw new Error("请填写不通过的原因，客户会看到");
  db().prepare("UPDATE topup_requests SET status = 'rejected', admin_note = ?, handled_at = datetime('now') WHERE id = ?").run(adminNote, id);
}

/* ---------------- 支付宝收款码 ---------------- */

export function saveAlipayQr(buf: Buffer) {
  const { mime, ext } = sniffMime(buf, null);
  if (!["image/png", "image/jpeg"].includes(mime)) throw new Error("收款码请上传 PNG 或 JPG 图片");
  const d = dir("assets");
  for (const f of fs.readdirSync(d)) if (f.startsWith("alipay-qr.")) fs.unlinkSync(path.join(d, f));
  fs.writeFileSync(path.join(d, `alipay-qr.${ext}`), buf);
}

export function readAlipayQr(): { buf: Buffer; mime: string } | null {
  const d = dir("assets");
  const f = fs.readdirSync(d).find((x) => x.startsWith("alipay-qr."));
  if (!f) return null;
  const buf = fs.readFileSync(path.join(d, f));
  return { buf, mime: sniffMime(buf, null).mime };
}
