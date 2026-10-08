/** 常见错误码的中文说明（完整列表见 ShipBest 文档“常见报错”）。 */
const ERROR_HINTS: Record<number, string> = {
  [-1]: "ShipBest 系统维护升级中",
  10022: "物流产品不存在",
  10023: "物流产品已停用",
  10024: "包裹重量不在该渠道的下单重量范围内",
  10061: "运费试算失败",
  10062: "该物流产品没有设置价格，请联系 ShipBest",
  10063: "自定义单号重复",
  11004: "API 授权信息无效（检查 apiId / accessToken）",
  11005: "请求频率超限，请稍后再试",
  11012: "签名错误",
  11013: "重复提交",
  11014: "时间戳无效（检查服务器时间）",
  11200: "OMS 账户余额不足，请先充值",
  11201: "OMS 账号已被停用",
  11202: "订单在 ShipBest 系统中不存在",
  11203: "该订单不支持取消",
  11204: "订单已取消，不能重复取消",
  11205: "订单异常，不支持取消",
  11206: "创建订单异常",
};

export class ShipBestError extends Error {
  constructor(
    public code: number,
    public apiMessage: string,
    public requestId?: string,
  ) {
    const hint = ERROR_HINTS[code];
    super(`[${code}] ${hint ? `${hint}（${apiMessage}）` : apiMessage}`);
    this.name = "ShipBestError";
  }
}

/**
 * 请服务商接口：超时、连不上时给出中文说明（哪家、等了多久），而不是 “The operation was aborted due to timeout”。
 * 这类错误不是服务商的明确拒绝，结果未知：下单时按“提交结果未知”处理，不当作失败删单。
 */
export async function providerFetch(provider: string, url: string, init: RequestInit & { timeoutMs: number }): Promise<{ res: Response; text: string }> {
  const { timeoutMs, ...rest } = init;
  try {
    const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    const text = await res.text();
    return { res, text };
  } catch (e) {
    throw networkError(provider, e, timeoutMs);
  }
}

export function networkError(provider: string, e: unknown, timeoutMs: number): Error {
  const err = e as Error & { cause?: { code?: string } };
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return new Error(`${provider} 接口超时：${Math.round(timeoutMs / 1000)} 秒没有响应，请稍后再试`);
  }
  const code = err?.cause?.code;
  return new Error(`${provider} 接口连不上${code ? `（${code}）` : ""}，请稍后再试`);
}
