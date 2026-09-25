/**
 * 时间显示：数据库里存的是 UTC（“2026-09-25 03:40:12”），页面和导出统一换成美西时间显示。
 * 时区固定写死（不用浏览器时区），服务端和客户端渲染结果一致。
 */
export const DISPLAY_TZ = process.env.NEXT_PUBLIC_DISPLAY_TZ || "America/Los_Angeles";
export const TZ_LABEL = DISPLAY_TZ === "America/Los_Angeles" ? "美西时间" : DISPLAY_TZ === "Asia/Shanghai" ? "北京时间" : DISPLAY_TZ;

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parseUtc(v: string): Date | null {
  if (!v) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

/** “2026-09-24 20:40” */
export function fmtTime(v: string | null | undefined): string {
  const d = v ? parseUtc(v) : null;
  if (!d) return v ?? "";
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** 只要日期 */
export function fmtDate(v: string | null | undefined): string {
  return fmtTime(v).slice(0, 10);
}
