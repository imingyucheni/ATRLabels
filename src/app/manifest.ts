import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { getSettings } from "@/lib/db";
import { adminOrigin } from "@/lib/sites";

export const dynamic = "force-dynamic";

/** 手机“添加到主屏幕”：图标、名称、主题色 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const name = getSettings().brandName || "ATRShip";
  // 从后台网址添加的打开后台首页，从客户网址添加的打开客户中心
  const host = (await headers()).get("host") ?? "";
  const onAdmin = !!adminOrigin() && adminOrigin().includes(host);
  return {
    name,
    short_name: name,
    start_url: onAdmin ? "/" : "/portal",
    display: "standalone",
    background_color: "#0b1b34",
    theme_color: "#0b1b34",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
