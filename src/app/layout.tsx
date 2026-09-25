import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { getPrefs } from "@/lib/prefs";
import { I18nProvider } from "@/components/I18n";

// 客户端也用这个根布局，这里不要写任何内部信息（服务商名称、成本等）
export const metadata: Metadata = {
  title: "Shipping Labels",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { theme, lang } = await getPrefs();
  return (
    <html lang={lang === "en" ? "en" : "zh-CN"} data-theme={theme === "auto" ? undefined : theme}>
      <body>
        <I18nProvider lang={lang}>{children}</I18nProvider>
      </body>
    </html>
  );
}
