import { NextResponse } from "next/server";
import { currentCustomerId, isLoggedIn } from "@/lib/auth";
import { getStore, newShopifyState, shopifySecrets, storesEnabled } from "@/lib/stores";
import { shopifyAuthorizeUrl } from "@/lib/stores/shopify";
import { publicBase, resultPage } from "@/lib/stores/web";

/** 后台 / 客户点“授权连接”：直接去这个店铺的 Shopify 授权页（店铺里已经装了 App 时可用） */
export async function GET(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("store"));
  const store = getStore(id);
  const admin = await isLoggedIn();
  const own = admin ? null : await currentCustomerId();
  if (!store || store.platform !== "shopify" || (!admin && store.customerId !== own)) return resultPage("店铺不存在", "请返回刷新后再试。", false);
  if (!admin && !storesEnabled(store.customerId)) return resultPage("还没有开放", "店铺对接还没有为你的账户开放，请联系客服。", false);
  const sec = shopifySecrets(id);
  if (!sec) return resultPage("还没有填写 App 信息", "请先填写这个店铺 Shopify App 的 Client ID 和 Client Secret。", false);
  return NextResponse.redirect(shopifyAuthorizeUrl(store.shop, sec.clientId, `${publicBase(req)}/api/stores/shopify/callback`, newShopifyState(id)));
}
