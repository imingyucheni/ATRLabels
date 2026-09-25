export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // 运单号这类长数字、以 0 开头的邮编：Excel 会变成科学计数法或丢掉前导 0，写成 ="..." 让 Excel 当文本
  if (typeof v === "string" && (/^\d{12,}$/.test(s) || /^0\d+$/.test(s))) return `"=""${s}"""`;
  // 防止 Excel 公式注入
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? "'" + s : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvResponse(filename: string, header: string[], rows: unknown[][]): Response {
  // 加 BOM，Excel 打开中文不乱码
  const body = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
