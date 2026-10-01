import { NextResponse } from "next/server";
import { findShopifyStore, newShopifyState, shopifySecrets } from "@/lib/stores";
import { normalizeShop, shopifyAuthorizeUrl, verifyShopifyHmac } from "@/lib/stores/shopify";
import { publicBase, resultPage } from "@/lib/stores/web";

/**
 * Shopify App 的 App URL：店主用安装链接装好 App 后，Shopify 打开这里（带 shop、hmac）。
 * 校验签名后跳到 Shopify 授权页，授权完回到 /api/stores/shopify/callback。
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const shop = normalizeShop(params.get("shop"));
  const store = shop ? findShopifyStore(shop) : undefined;
  if (!shop || !store) return resultPage("店铺还没有登记", "这个 Shopify 店铺还没有在我们的系统里登记，请联系客服。", false);
  const sec = shopifySecrets(store.id);
  if (!sec || !verifyShopifyHmac(params, sec.clientSecret)) return resultPage("请求无效", "签名校验没通过，请从 Shopify 后台重新打开应用。", false);
  const state = newShopifyState(store.id);
  return NextResponse.redirect(shopifyAuthorizeUrl(shop, sec.clientId, `${publicBase(req)}/api/stores/shopify/callback`, state));
}
