/**
 * 检查服务商返回的面单上是否已经印了这一单的 SKU：
 * 有 → 不再加印；有文字但没有 SKU → 自动加印；图片面单（读不出文字）→ 按渠道 / 全局设置。
 * 每张面单下载后检查一次，结果存在 shipments.label_sku，设置页按渠道汇总，能看出哪些渠道的面单自带 SKU。
 */
import { db, getShipment, updateShipment, type LabelSku } from "./db";
import { readLabel } from "./labels";

const norm = (t: string) => t.toUpperCase().replace(/[\s ]+/g, "");
const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 按面单上的文字判断（纯函数，方便测试） */
export function skuOnLabel(text: string, skus: string[]): LabelSku {
  // 文字太少说明是整张图片（常见于 ZPL 转成的 PDF），看不出来
  if (text.replace(/[^A-Za-z0-9]/g, "").length < 15) return "image";
  const list = skus.map((k) => k.trim()).filter(Boolean);
  if (!list.length) return "no";
  const flat = norm(text);
  const upper = text.toUpperCase();
  const found = list.some((k) => {
    const nk = norm(k);
    if (nk.length >= 4) return flat.includes(nk);
    // 很短的 SKU（例如 “A1”）容易在别的文字里碰巧出现，要求前后不是字母数字
    return new RegExp(`(^|[^A-Z0-9])${escapeRe(k.toUpperCase())}([^A-Z0-9]|$)`).test(upper);
  });
  return found ? "yes" : "no";
}

/** 读出 PDF 里的文字；读不出来返回空字符串 */
export async function pdfLabelText(buf: Buffer): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch {
    return "";
  }
}

export async function detectLabelSku(buf: Buffer, mime: string | null, skus: string[]): Promise<LabelSku> {
  if (mime !== "application/pdf") return "image";
  return skuOnLabel(await pdfLabelText(buf), skus);
}

/** 检查一张已保存的面单并记下结果 */
export async function checkShipmentLabel(id: number): Promise<LabelSku | null> {
  const s = getShipment(id);
  if (!s?.labelPath) return null;
  let result: LabelSku;
  try {
    result = await detectLabelSku(readLabel(s.labelPath), s.labelMime, s.skuList.map((k) => k.sku));
  } catch {
    result = "image";
  }
  updateShipment(id, { labelSku: result });
  return result;
}

/** 以前的面单还没检查过的，后台慢慢补查 */
export async function backfillLabelSku(limit = 10) {
  const ids = (
    db().prepare("SELECT id FROM shipments WHERE label_path IS NOT NULL AND label_sku IS NULL ORDER BY id DESC LIMIT ?").all(limit) as { id: number }[]
  ).map((r) => r.id);
  for (const id of ids) await checkShipmentLabel(id).catch(() => null);
  return ids.length;
}

/** 按渠道汇总最近 60 天的检查结果（设置页显示） */
export function labelSkuStats(): Record<string, { yes: number; no: number; image: number }> {
  const rows = db()
    .prepare(
      `SELECT channel_code, label_sku, COUNT(*) AS n FROM shipments
       WHERE label_sku IS NOT NULL AND created_at >= datetime('now', '-60 days') GROUP BY channel_code, label_sku`,
    )
    .all() as { channel_code: string; label_sku: LabelSku; n: number }[];
  const out: Record<string, { yes: number; no: number; image: number }> = {};
  for (const r of rows) (out[r.channel_code] ??= { yes: 0, no: 0, image: 0 })[r.label_sku] += r.n;
  return out;
}
