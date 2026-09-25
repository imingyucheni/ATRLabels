import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";

// 客户端也用这个根布局，这里不要写任何内部信息（服务商名称、成本等）
export const metadata: Metadata = {
  title: "Shipping Labels",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
