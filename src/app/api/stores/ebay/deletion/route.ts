import { ebaySettings, forgetEbayUser } from "@/lib/stores";
import { ebayChallengeResponse, verifyEbayNotification } from "@/lib/stores/ebay";
import { publicBase } from "@/lib/stores/web";

/**
 * eBay “账户删除通知”（Marketplace Account Deletion）：eBay 要求开发者必须订阅。
 * GET 带 challenge_code：返回 sha256(challengeCode + verificationToken + 这个网址) 证明网址是我们的；
 * POST：某个 eBay 用户删除了账号，清掉我们存的这个买家的个人信息（先验证 eBay 的签名）。
 */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("challenge_code");
  const token = ebaySettings().verificationToken;
  if (!code || !token) return new Response("missing", { status: 400 });
  const endpoint = `${publicBase(req)}/api/stores/ebay/deletion`;
  return Response.json({ challengeResponse: ebayChallengeResponse(code, token, endpoint) });
}

export async function POST(req: Request) {
  // 只处理 eBay 签过名的通知：别人伪造请求不能让我们删数据
  const s = ebaySettings();
  if (!s.clientId || !s.clientSecret) return new Response("not configured", { status: 401 });
  const raw = await req.text();
  let ok: boolean;
  try {
    ok = await verifyEbayNotification(s, req.headers.get("x-ebay-signature"), raw);
  } catch {
    return new Response("verify failed", { status: 500 }); // 取公钥失败：eBay 会重试
  }
  if (!ok) return new Response("bad signature", { status: 401 });
  let body: { notification?: { data?: { username?: string } } } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    /* 签名对但内容不是 JSON：忽略 */
  }
  const user = body.notification?.data?.username;
  if (user) forgetEbayUser(String(user).slice(0, 100));
  return new Response(null, { status: 204 });
}
