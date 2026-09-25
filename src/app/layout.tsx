import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ATR 面单系统",
  description: "尾程面单：对接 ShipBest，按成本加价出单",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
