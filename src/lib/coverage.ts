/**
 * 派送范围（邮编覆盖表）：
 * 服务商给的报价表里有各渠道的“邮编表”（GOFO / SwiftX / UNI / SPX 等），列出能派送的目的地邮编和分区。
 * 实测（2026-09，80 次真实试算）：表里没有、但 ShipBest 实际能送的约占 11%（SPX 尤其多），
 * 所以邮编表默认只作参考，每个渠道可以单独打开“按邮编表预筛”。
 * 另外自动记住接口回复“不通邮”的 渠道 + 邮编（30 天），下次直接跳过，这部分结果来自接口本身，是准确的。
 */
import { randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import { cellText } from "./adjustments";
import { db, getSettings, listChannels } from "./db";

export interface CoverageSheet {
  sheet: string;
  /** 识别方式说明，例如“按 Gate 列筛选 LAX” */
  how: string;
  /** 这个口岸下的邮编数 */
  count: number;
  sample: string[];
  /** 按工作表名称猜的渠道代码 */
  guess: string | null;
  error?: string;
}

interface Parsed {
  sheets: (CoverageSheet & { zips: Map<string, string> })[];
  filename: string;
  gateway: string;
  expires: number;
}

const g = globalThis as unknown as { __coverageUploads?: Map<string, Parsed> };
const uploads = (g.__coverageUploads ??= new Map());

const ZIP_HEAD = /^(目的地邮编|邮编|zip ?codes?|zipcode|postal ?code|delivery zip ?code)$/i;
const GATE_HEAD = /^(gate|gateway|口岸|origin ?hub|hub)$/i;
const ZONE_HEAD = /^(zone|分区|zones?)$/i;

export function normZip(v: string): string | null {
  const d = String(v ?? "").trim().match(/^\d{3,5}/)?.[0];
  if (!d) return null;
  return d.padStart(5, "0");
}

/** 从一张工作表里取出某个口岸能派送的邮编（和分区） */
export function extractZips(rows: string[][], gateway: string): { zips: Map<string, string>; how: string } | { error: string } {
  const gw = gateway.trim().toUpperCase();
  // 表头可能有两层（合并单元格的分组标题 + 真正的列名），逐行找，优先用能识别出口岸的那一行
  const candidates: { h: number; head: string[]; zipCol: number }[] = [];
  for (let h = 0; h < Math.min(rows.length, 8); h++) {
    const head = rows[h].map((c) => (c ?? "").trim());
    const zipCol = head.findIndex((c) => ZIP_HEAD.test(c));
    if (zipCol >= 0) candidates.push({ h, head, zipCol });
  }
  if (!candidates.length) return { error: "没找到“邮编 / Zip Code”表头" };
  for (const { h, head, zipCol } of candidates) {
    const zips = new Map<string, string>();
    const gateCol = head.findIndex((c, i) => i !== zipCol && GATE_HEAD.test(c));
    const zoneCol = head.findIndex((c, i) => i !== zipCol && ZONE_HEAD.test(c));
    // 1) 有“口岸 / Gate”列：按口岸筛选
    if (gateCol >= 0) {
      for (const r of rows.slice(h + 1)) {
        const z = normZip(r[zipCol]);
        if (!z || (r[gateCol] ?? "").trim().toUpperCase() !== gw) continue;
        zips.set(z, zoneCol >= 0 ? (r[zoneCol] ?? "").trim() : "");
      }
      return { zips, how: `按“${head[gateCol]}”列筛选 ${gw}` };
    }
    // 2) 各口岸是单独的列（GOFO：LAX / DFW / … 列里是分区）
    const gwCol = head.findIndex((c) => c.toUpperCase() === gw);
    if (gwCol >= 0) {
      for (const r of rows.slice(h + 1)) {
        const z = normZip(r[zipCol]);
        const zone = (r[gwCol] ?? "").trim();
        if (z && zone) zips.set(z, zone);
      }
      return { zips, how: `取 ${gw} 列有分区的邮编` };
    }
  }
  // 3) 没有口岸信息：整张表都算
  const { h, head, zipCol } = candidates[candidates.length - 1];
  const zoneCol = head.findIndex((c, i) => i !== zipCol && ZONE_HEAD.test(c));
  const zips = new Map<string, string>();
  for (const r of rows.slice(h + 1)) {
    const z = normZip(r[zipCol]);
    if (z) zips.set(z, zoneCol >= 0 ? (r[zoneCol] ?? "").trim() : "");
  }
  return { zips, how: "表里没有口岸列，按全部邮编" };
}

function guessChannel(sheet: string): string | null {
  const s = sheet.toUpperCase().replace(/\s/g, "");
  const keys: [RegExp, RegExp][] = [
    [/GOFO/, /GOFO/i],
    [/SWIFTX/, /SWIFTX/i],
    [/UNI/, /UNIUNI|^UNI/i],
    [/SPX|SPEEDX/, /SPX|SPEEDX/i],
    [/USPS/, /USPS/i],
    [/YWE|燕文/, /^YWE-/i],
  ];
  const chans = listChannels(true);
  for (const [sk, ck] of keys) if (sk.test(s)) return chans.find((c) => ck.test(c.name.replace(/\s/g, "")))?.code ?? null;
  return null;
}

/** 解析上传的工作簿：只看名字里带“邮编 / zip”的工作表（报价、偏远等其他表跳过） */
export async function parseCoverageWorkbook(filename: string, buf: Buffer, gateway?: string) {
  if (!filename.toLowerCase().endsWith(".xlsx")) throw new Error("请上传 .xlsx 文件");
  const gw = (gateway || getSettings().originGateway || "LAX").trim().toUpperCase();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheets: Parsed["sheets"] = [];
  for (const ws of wb.worksheets) {
    if (!/邮编|zip/i.test(ws.name) || /偏远|remote|das/i.test(ws.name)) continue;
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = row.values as ExcelJS.CellValue[];
      rows.push(Array.from({ length: Math.max(0, vals.length - 1) }, (_, i) => cellText(vals[i + 1])));
    });
    const r = extractZips(rows, gw);
    const guess = guessChannel(ws.name);
    if ("error" in r) sheets.push({ sheet: ws.name, how: "", count: 0, sample: [], guess, error: r.error, zips: new Map() });
    else sheets.push({ sheet: ws.name, how: r.how, count: r.zips.size, sample: [...r.zips.keys()].slice(0, 5), guess, zips: r.zips });
  }
  if (!sheets.length) throw new Error("这个文件里没有找到“邮编”工作表（工作表名称需要带“邮编”或 zip）");
  const token = randomBytes(12).toString("hex");
  const now = Date.now();
  for (const [k, v] of uploads) if (v.expires < now) uploads.delete(k);
  uploads.set(token, { sheets, filename, gateway: gw, expires: now + 30 * 60_000 });
  return { token, gateway: gw, sheets: sheets.map(({ zips: _z, ...s }) => s) };
}

/** 确认导入：sheet → 渠道代码；同一渠道原来的覆盖表整体替换 */
export function importCoverage(token: string, mapping: Record<string, string>) {
  const up = uploads.get(token);
  if (!up) throw new Error("上传已过期，请重新上传文件");
  const known = new Set(listChannels().map((c) => c.code));
  const done: { channel: string; count: number }[] = [];
  db().transaction(() => {
    for (const s of up.sheets) {
      const code = mapping[s.sheet];
      if (!code || !known.has(code) || !s.zips.size) continue;
      db().prepare("DELETE FROM channel_zips WHERE channel_code = ?").run(code);
      const ins = db().prepare("INSERT OR REPLACE INTO channel_zips (channel_code, zip, zone) VALUES (?, ?, ?)");
      for (const [z, zone] of s.zips) ins.run(code, z, zone || null);
      db()
        .prepare(
          `INSERT INTO coverage_sources (channel_code, filename, sheet, gateway, zip_count, uploaded_at) VALUES (?,?,?,?,?, datetime('now'))
           ON CONFLICT(channel_code) DO UPDATE SET filename = excluded.filename, sheet = excluded.sheet, gateway = excluded.gateway,
           zip_count = excluded.zip_count, uploaded_at = excluded.uploaded_at`,
        )
        .run(code, up.filename, s.sheet, up.gateway, s.zips.size);
      done.push({ channel: code, count: s.zips.size });
    }
  })();
  uploads.delete(token);
  return done;
}

export interface CoverageSource {
  channelCode: string;
  prefilter: boolean;
  filename: string;
  sheet: string;
  gateway: string;
  zipCount: number;
  uploadedAt: string;
}

export function listCoverage(): CoverageSource[] {
  return (
    db().prepare("SELECT * FROM coverage_sources ORDER BY channel_code").all() as {
      channel_code: string; filename: string; sheet: string; gateway: string; zip_count: number; uploaded_at: string; prefilter: number;
    }[]
  ).map((r) => ({ channelCode: r.channel_code, prefilter: !!r.prefilter, filename: r.filename, sheet: r.sheet, gateway: r.gateway, zipCount: r.zip_count, uploadedAt: r.uploaded_at }));
}

export function setPrefilter(code: string, on: boolean) {
  db().prepare("UPDATE coverage_sources SET prefilter = ? WHERE channel_code = ?").run(on ? 1 : 0, code);
}

export function removeCoverage(code: string) {
  db().transaction(() => {
    db().prepare("DELETE FROM channel_zips WHERE channel_code = ?").run(code);
    db().prepare("DELETE FROM coverage_sources WHERE channel_code = ?").run(code);
  })();
}

/**
 * 这个渠道能不能派送到这个邮编：
 * true / false = 按覆盖表判断；null = 这个渠道没有上传覆盖表（交给接口判断）
 */
export function coverageFor(code: string, zip: string): { covered: boolean; zone: string | null } | null {
  const has = db().prepare("SELECT 1 FROM coverage_sources WHERE channel_code = ?").get(code);
  if (!has) return null;
  const z = normZip(zip);
  if (!z) return null;
  const r = db().prepare("SELECT zone FROM channel_zips WHERE channel_code = ? AND zip = ?").get(code, z) as { zone: string | null } | undefined;
  return { covered: !!r, zone: r?.zone ?? null };
}

/* ---------------- 接口“不通邮”记忆 ---------------- */

const BLOCK_DAYS = 30;
/** ShipBest 表示地址不在派送范围的报错 */
export const isUnsupportedError = (msg: string) => /不通邮|不支持.*邮编|邮编.*不支持|not (in )?service area|unserviceable/i.test(msg);

export function blockedZip(code: string, zip: string): { reason: string | null; checkedAt: string } | null {
  const z = normZip(zip);
  if (!z) return null;
  const r = db()
    .prepare(`SELECT reason, checked_at FROM zip_blocks WHERE channel_code = ? AND zip = ? AND checked_at >= datetime('now', '-${BLOCK_DAYS} days')`)
    .get(code, z) as { reason: string | null; checked_at: string } | undefined;
  return r ? { reason: r.reason, checkedAt: r.checked_at } : null;
}

/** 记录一次试算结果：不通邮 → 记住；能送 → 清除记忆 */
export function rememberQuote(code: string, zip: string, ok: boolean, error?: string) {
  const z = normZip(zip);
  if (!z) return;
  if (ok) db().prepare("DELETE FROM zip_blocks WHERE channel_code = ? AND zip = ?").run(code, z);
  else if (error && isUnsupportedError(error)) {
    db()
      .prepare("INSERT INTO zip_blocks (channel_code, zip, reason, checked_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(channel_code, zip) DO UPDATE SET reason = excluded.reason, checked_at = excluded.checked_at")
      .run(code, z, error.slice(0, 200));
  }
}

export function blockStats() {
  return (db().prepare(`SELECT channel_code, COUNT(*) AS n FROM zip_blocks WHERE checked_at >= datetime('now', '-${BLOCK_DAYS} days') GROUP BY channel_code`).all() as { channel_code: string; n: number }[])
    .reduce<Record<string, number>>((a, r) => ((a[r.channel_code] = r.n), a), {});
}

export function clearBlocks(code?: string) {
  if (code) db().prepare("DELETE FROM zip_blocks WHERE channel_code = ?").run(code);
  else db().prepare("DELETE FROM zip_blocks").run();
}

/**
 * 试算前的预判：返回不为空时直接判定送不到，不调接口。
 * 1) 接口最近回复过这个邮编不通邮；2) 打开了“按邮编表预筛”且邮编不在表里
 */
export function precheck(code: string, zip: string): string | null {
  const b = blockedZip(code, zip);
  if (b) return `该地址不在此渠道的派送范围内（邮编 ${normZip(zip)}，${b.checkedAt.slice(0, 10)} 查询过）`;
  const on = db().prepare("SELECT prefilter FROM coverage_sources WHERE channel_code = ?").get(code) as { prefilter: number } | undefined;
  if (on?.prefilter) {
    const c = coverageFor(code, zip);
    if (c && !c.covered) return `该地址不在此渠道的派送范围内（邮编 ${normZip(zip)} 不在邮编表里）`;
  }
  return null;
}

/** 查询某个邮编在各渠道的覆盖情况（后台“派送范围”页面的查询工具） */
export function lookupZip(zip: string) {
  return listChannels().map((c) => ({
    code: c.code, name: c.name, enabled: c.enabled, result: coverageFor(c.code, zip), blocked: blockedZip(c.code, zip),
  }));
}
