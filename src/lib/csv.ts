export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
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
