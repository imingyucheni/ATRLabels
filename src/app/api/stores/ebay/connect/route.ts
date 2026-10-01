import { NextResponse } from "next/server";
import { currentCustomerId } from "@/lib/auth";
import { addDemoEbay, ebaySettings, startEbayConnection, syncStore } from "@/lib/stores";
import { ebayAuthorizeUrl } from "@/lib/stores/ebay";
import { isMockMode } from "@/lib/shipbest/client";
import { publicBase, resultPage } from "@/lib/stores/web";

/** 客户点“连接 eBay”：建一条待授权的连接，跳到 eBay 授权页 */
export async function GET(req: Request) {
  const customerId = await currentCustomerId();
  if (!customerId) return NextResponse.redirect(`${publicBase(req)}/portal/login`);
  const s = ebaySettings();
  if (!s.enabled || !s.clientId || !s.ruName) {
    // 演示环境：没配 eBay 时加一个模拟店铺
    if (isMockMode()) {
      await syncStore(addDemoEbay(customerId)).catch(() => null);
      return NextResponse.redirect(`${publicBase(req)}/portal/stores?connected=ebay`);
    }
    return resultPage("eBay 对接还没开通", "请联系客服开通 eBay 对接。", false);
  }
  const { state } = startEbayConnection(customerId);
  return NextResponse.redirect(ebayAuthorizeUrl(s, state));
}
