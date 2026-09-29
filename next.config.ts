import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // GitHub Actions 预先构建发布包时打成独立包（服务器只需下载运行，不用在小内存服务器上构建）
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  // 数据目录和测试不要打进发布包
  outputFileTracingExcludes: { "*": ["data/**", "data-demo/**", "tests/**", "scripts/**", ".env*"] },
  // 基本安全响应头：禁止别的网站用 iframe 嵌入（防点击劫持）、禁止浏览器猜文件类型、HTTPS 下强制 HTTPS
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=15552000" },
        ],
      },
    ];
  },
  // 客户 OMS 网址的首页 = 官网：proxy.ts 给这种请求加上 x-atr-oms-home 头，这里转到 /site
  async rewrites() {
    return { beforeFiles: [{ source: "/", has: [{ type: "header", key: "x-atr-oms-home" }], destination: "/site" }], afterFiles: [], fallback: [] };
  },
  serverExternalPackages: ["better-sqlite3", "exceljs", "pdf-lib", "nodemailer", "unpdf"],
  experimental: {
    serverActions: {
      // 补差表、批量下单表通过 Server Action 上传，默认 1MB 不够
      bodySizeLimit: "12mb",
      // 放在反向代理后面（GitHub Codespaces、Render 等）时，代理的域名和实际 Host 不一致，
      // 需要把对外域名加入白名单；自定义域名可以用 ALLOWED_ORIGINS=a.com,b.com 追加
      allowedOrigins: [
        "localhost:3000",
        "*.app.github.dev",
        "*.onrender.com",
        ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      ],
    },
  },
};

export default nextConfig;
