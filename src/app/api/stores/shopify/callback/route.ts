import { NextResponse } from "next/server";
import { currentCustomerId } from "@/lib/auth";
import { findStoreByState, saveStoreToken, shopifySecrets, syncStore } from "@/lib/stores";
import { exchangeShopifyCode, normalizeShop, verifyShopifyHmac } from "@/lib/stores/shopify";
import { publicBase, resultPage } from "@/lib/stores/web";

/** Shopify 授权回调：校验 state / hmac / 店铺，换访问令牌，然后先同步一次订单 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const store = findStoreByState(params.get("state") ?? "");
  const shop = normalizeShop(params.get("shop"));
  if (!store || store.platform !== "shopify" || !shop || shop !== store.shop) return resultPage("授权失败", "链接已失效或店铺不匹配，请重新连接。", false);
  const sec = shopifySecrets(store.id);
  if (!sec || !verifyShopifyHmac(params, sec.clientSecret)) return resultPage("授权失败", "签名校验没通过，请重新连接。", false);
  try {
    const token = await exchangeShopifyCode(shop, sec.clientId, sec.clientSecret, params.get("code") ?? "");
    saveStoreToken(store.id, token);
    await syncStore(store.id).catch(() => null);
    // 客户自己在 OMS 里点的授权：直接回到店铺订单页
    if ((await currentCustomerId()) === store.customer_id) return NextResponse.redirect(`${publicBase(req)}/portal/stores?connected=shopify`);
    return resultPage("Shopify 店铺已连接", `${shop} 已经连接到我们的发货系统。未发货的订单会自动同步到客户中心的“店铺订单”，出单后运单号自动回传 Shopify。`, true, { href: `${publicBase(req)}/portal/stores`, label: "打开店铺订单" });
  } catch (e) {
    return resultPage("授权失败", (e as Error).message, false, { href: `${publicBase(req)}/portal/stores`, label: "返回店铺订单" });
  }
}
