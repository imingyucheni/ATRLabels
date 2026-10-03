export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // 运单号这类长数字、以 0 开头的邮编：Excel 会变成科学计数法或丢掉前导 0，写成 ="..." 让 Excel 当文本
  if (typeof v === "string" && (/^\d{12,}$/.test(s) || /^0\d+$/.test(s))) return `"=""${s}"""`;
  // 防止 Excel 公式注入
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvResponse(filename: string, header: string[], rows: unknown[][]): Response {
  // 加 BOM，Excel 打开中文不乱码
  const body = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // 老浏览器 / 部分下载工具不认 filename*：先给一个英文文件名兜底
      "Content-Disposition": `attachment; filename="${asciiName(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

/** 兜底的英文文件名：中文去掉后只剩日期时（例如“流水-2026-10-02.csv”），前面补上 export */
function asciiName(filename: string) {
  const a = filename.replace(/[^\w.-]+/g, "_").replace(/^[_-]+/, "");
  if (!a || a.startsWith(".")) return "export.csv";
  return /^[A-Za-z]/.test(a) ? a : `export-${a}`;
}
