import { NextResponse } from "next/server";
import { deleteStore, ebaySettings, findStoreByState, finishEbayConnection, syncStore } from "@/lib/stores";
import { ebayUsername, exchangeEbayCode } from "@/lib/stores/ebay";
import { publicBase, resultPage } from "@/lib/stores/web";

/** eBay 授权回调（eBay 后台 RuName 的 “Auth accepted URL” 填这个地址） */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const store = findStoreByState(params.get("state") ?? "");
  if (!store || store.platform !== "ebay") return resultPage("授权失败", "链接已失效，请回到客户中心重新点“连接 eBay”。", false);
  const code = params.get("code");
  if (!code) {
    // 卖家在 eBay 页面点了拒绝
    deleteStore(store.id);
    return NextResponse.redirect(`${publicBase(req)}/portal/stores?denied=1`);
  }
  try {
    const s = ebaySettings();
    const token = await exchangeEbayCode(s, code);
    const user = await ebayUsername(s, token.accessToken);
    const id = finishEbayConnection(store.id, token, user);
    await syncStore(id).catch(() => null);
    return NextResponse.redirect(`${publicBase(req)}/portal/stores?connected=ebay`);
  } catch (e) {
    return resultPage("授权失败", (e as Error).message, false, { href: `${publicBase(req)}/portal/stores`, label: "返回店铺订单" });
  }
}
