import { getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * 接口参考（可在线试调）：用 Swagger UI 展示 /api/v1/openapi.json（Swagger UI 文件放在 public/vendor，不依赖外部 CDN）。
 * 填上测试密钥点 “Try it out” 就能直接在页面上调用（同域名请求，不经过第三方）。
 */
export function GET() {
  const brand = esc(getSettings().brandName);
  const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${brand} API Reference</title>
<link rel="stylesheet" href="/vendor/swagger-ui/swagger-ui.css">
<style>
  body{margin:0;background:#fff;font-family:system-ui,-apple-system,"PingFang SC",sans-serif}
  .top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px 20px;border-bottom:1px solid #e5e5e5}
  .top b{font-size:16px}.top a{color:#0f766e;text-decoration:none;font-size:14px}
  .tip{margin:12px 20px 0;padding:10px 14px;border-radius:10px;background:#f0fdf4;color:#166534;font-size:13px;line-height:1.6}
  .swagger-ui .topbar{display:none}
</style>
</head>
<body>
<div class="top"><b>${brand} API Reference</b><span><a href="/site/developers">← 返回接口文档</a> &nbsp; <a href="/api/v1/openapi.json" target="_blank">openapi.json</a></span></div>
<div class="tip">在线试调：点右边的 <b>Authorize</b>，填客户中心「API 对接」里生成的<b>测试密钥</b>（atr_test_…，模拟出单不扣钱），再在接口里点 <b>Try it out</b> → <b>Execute</b>。不要在这里用正式密钥试出单。</div>
<div id="ui"></div>
<script src="/vendor/swagger-ui/swagger-ui-bundle.js"></script>
<script>
  window.ui = SwaggerUIBundle({ url: "/api/v1/openapi.json", dom_id: "#ui", deepLinking: true, persistAuthorization: false, tryItOutEnabled: false, defaultModelsExpandDepth: 0, docExpansion: "list" });
</script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
