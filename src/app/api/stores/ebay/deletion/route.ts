import { ebaySettings, forgetEbayUser } from "@/lib/stores";
import { ebayChallengeResponse } from "@/lib/stores/ebay";
import { publicBase } from "@/lib/stores/web";

/**
 * eBay “账户删除通知”（Marketplace Account Deletion）：eBay 要求开发者必须订阅。
 * GET 带 challenge_code：返回 sha256(challengeCode + verificationToken + 这个网址) 证明网址是我们的；
 * POST：某个 eBay 用户删除了账号，清掉我们存的这个买家的个人信息。
 */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("challenge_code");
  const token = ebaySettings().verificationToken;
  if (!code || !token) return new Response("missing", { status: 400 });
  const endpoint = `${publicBase(req)}/api/stores/ebay/deletion`;
  return Response.json({ challengeResponse: ebayChallengeResponse(code, token, endpoint) });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { notification?: { data?: { username?: string } } };
  const user = body.notification?.data?.username;
  if (user) forgetEbayUser(String(user).slice(0, 100));
  return new Response(null, { status: 204 });
}
