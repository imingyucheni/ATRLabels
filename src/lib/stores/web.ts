/** 店铺授权用到的网址和小页面 */
export function publicBase(req: { headers: { get(name: string): string | null } }): string {
  const env = (process.env.APP_URL || process.env.OMS_URL || "").replace(/\/+$/, "");
  if (env) return env;
  const h = req.headers;
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** 授权完成 / 出错时给店主看的简单页面（店主不一定登录了我们的系统） */
export function resultPage(title: string, message: string, ok: boolean, link?: { href: string; label: string }) {
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,-apple-system,"PingFang SC",sans-serif;background:#f6f6f7;color:#1a1a1a;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
.c{background:#fff;border:1px solid #e3e3e6;border-radius:14px;padding:28px;max-width:440px;width:100%;box-shadow:0 8px 30px rgba(0,0,0,.06)}
h1{font-size:20px;margin:0 0 8px;color:${ok ? "#0f766e" : "#b42318"}}p{line-height:1.6;color:#4b4b52;margin:0 0 16px}a{display:inline-block;background:#111;color:#fff;padding:9px 16px;border-radius:9px;text-decoration:none}
@media (prefers-color-scheme:dark){body{background:#111113;color:#ededee}.c{background:#1b1b1e;border-color:#2c2c30}p{color:#c4c4c9}a{background:#ededee;color:#111}}</style></head>
<body><div class="c"><h1>${esc(title)}</h1><p>${esc(message)}</p>${link ? `<a href="${esc(link.href)}">${esc(link.label)}</a>` : ""}</div></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
