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
