import { createHmac, randomInt } from "node:crypto";

export interface SignInput {
  apiId: string;
  accessToken: string;
  /** 接口路径，例如 /api/order/detail */
  url: string;
  timestamp: string;
  nonce: string;
  method?: string;
}

/**
 * 按 ShipBest 文档拼接待签名字符串：
 * apiId、accessToken、method、nonce、timestamp、url 六个参数按 key 排序后用 & 拼接。
 */
export function buildSignString(input: SignInput): string {
  const params: Record<string, string> = {
    accessToken: input.accessToken,
    apiId: input.apiId,
    method: input.method ?? "post",
    nonce: input.nonce,
    timestamp: input.timestamp,
    url: input.url,
  };
  return Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("&");
}

/** HmacSHA256(accessToken 为密钥)，输出小写十六进制。 */
export function sign(input: SignInput): string {
  return createHmac("sha256", input.accessToken).update(buildSignString(input), "utf8").digest("hex");
}

/** 生成一次请求需要的公共请求头。 */
export function buildHeaders(apiId: string, accessToken: string, url: string, now = Date.now()) {
  const timestamp = String(now);
  // 文档建议 2 位随机数字
  const nonce = String(randomInt(10, 100));
  return {
    apiId,
    accessToken,
    timestamp,
    nonce,
    sign: sign({ apiId, accessToken, url, timestamp, nonce }),
  };
}
