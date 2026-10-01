/** 开放 API 的 OpenAPI 3 描述（很多系统能直接导入；文档页也按它来写） */
export function openapiSpec(base: string, brand: string) {
  const addr = {
    type: "object",
    required: ["name", "address1", "city", "postalCode", "country"],
    properties: {
      name: { type: "string", description: "收件人 / 寄件人姓名（也可以分开传 firstName、lastName）", example: "Jane Roe" },
      firstName: { type: "string" },
      lastName: { type: "string" },
      company: { type: "string" },
      phone: { type: "string", example: "5125550100" },
      email: { type: "string" },
      address1: { type: "string", example: "500 Congress Ave" },
      address2: { type: "string", example: "Apt 2" },
      city: { type: "string", example: "Austin" },
      state: { type: "string", description: "美国填州二字码", example: "TX" },
      postalCode: { type: "string", example: "78701" },
      country: { type: "string", description: "国家二字码，默认 US", example: "US" },
    },
  };
  const pkg = {
    type: "object",
    required: ["length", "width", "height", "weight"],
    properties: {
      length: { type: "number", example: 10 },
      width: { type: "number", example: 8 },
      height: { type: "number", example: 4 },
      weight: { type: "number", example: 1.5 },
      unit: { type: "string", enum: ["in/lb", "cm/kg", "cm/g"], default: "in/lb" },
      signature: { type: "string", enum: ["none", "direct", "indirect", "adult"], default: "none" },
    },
  };
  const item = {
    type: "object",
    properties: {
      sku: { type: "string", example: "TS-BLK-M" },
      name: { type: "string", description: "英文品名", example: "Cotton T-shirt" },
      nameCn: { type: "string", description: "中文品名（可选）" },
      quantity: { type: "integer", example: 1 },
      unitValue: { type: "number", description: "单件申报价值 USD", example: 12 },
      hsCode: { type: "string", description: "国际件必填" },
      originCountry: { type: "string", description: "国际件原产国二字码" },
      material: { type: "string", description: "国际件材质" },
    },
  };
  const shipment = {
    type: "object",
    required: ["shipTo", "package"],
    properties: {
      shipFrom: { ...addr, description: "不传时用账户的默认寄件地址" },
      shipTo: addr,
      package: pkg,
      items: { type: "array", items: item, description: "可选；美国件不传时按一件普通货物处理" },
    },
  };
  const order = {
    type: "object",
    properties: {
      orderNo: { type: "string", description: `${brand} 的单号`, example: "ATR261001A1B2C3D4" },
      referenceNo: { type: "string", description: "你们系统的订单号", example: "SO-1001" },
      status: { type: "string", enum: ["processing", "labeled", "cancelling", "cancelled", "exception"] },
      channel: { type: "string" },
      channelName: { type: "string" },
      carrier: { type: "string", example: "usps" },
      trackingNo: { type: "string", nullable: true },
      trackingUrl: { type: "string", nullable: true },
      price: { type: "number" },
      currency: { type: "string", example: "USD" },
      zone: { type: "string", nullable: true },
      labelReady: { type: "boolean" },
      labelUrl: { type: "string", nullable: true },
      test: { type: "boolean", description: "测试密钥出的模拟单" },
      createdAt: { type: "string" },
    },
  };
  const envelope = (data: unknown) => ({
    type: "object",
    properties: { success: { type: "boolean" }, code: { type: "string", example: "OK" }, message: { type: "string" }, data },
  });
  const ok = (data: unknown, description = "成功") => ({ description, content: { "application/json": { schema: envelope(data) } } });
  const err = { description: "失败：success=false，code 见文档错误码", content: { "application/json": { schema: envelope({}) } } };
  const noParam = { name: "no", in: "path", required: true, schema: { type: "string" }, description: "orderNo，或你们的 referenceNo" };

  return {
    openapi: "3.0.3",
    info: { title: `${brand} Shipping API`, version: "1.0.0", description: "美国本土尾程 / 国际快递面单：报价、出单、取面单、查状态、取消。" },
    servers: [{ url: `${base}/api/v1` }],
    security: [{ bearer: [] }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "客户中心「API 对接」里生成的密钥：atr_live_…（正式）或 atr_test_…（测试，模拟出单不扣钱）" } } },
    paths: {
      "/channels": { get: { tags: ["渠道与报价 Rates"], summary: "可用渠道", responses: { 200: ok({ type: "array", items: { type: "object", properties: { channel: { type: "string" }, name: { type: "string" }, carrier: { type: "string" }, international: { type: "boolean" } } } }), 401: err } } },
      "/rates": {
        post: {
          tags: ["渠道与报价 Rates"],
          summary: "运费试算",
          requestBody: { required: true, content: { "application/json": { schema: { ...shipment, properties: { ...shipment.properties, channel: { type: "string", description: "只算这个渠道（可选）" } } } } } },
          responses: { 200: ok({ type: "array", items: { type: "object", properties: { channel: { type: "string" }, name: { type: "string" }, carrier: { type: "string" }, available: { type: "boolean" }, price: { type: "number" }, currency: { type: "string" }, zone: { type: "string" }, error: { type: "string" } } } }), 400: err },
        },
      },
      "/orders": {
        post: {
          tags: ["订单 Orders"],
          summary: "出单（同一个 referenceNo 重复提交返回已有的单，不会重复扣费）",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  ...shipment,
                  required: ["referenceNo", "channel", "shipTo", "package"],
                  properties: {
                    referenceNo: { type: "string", description: "你们系统的订单号（最长 50 位）" },
                    channel: { type: "string", description: "渠道代码（/channels 或 /rates 返回的 channel）" },
                    expectedPrice: { type: "number", description: "报价时的价格；填了的话价格变了会返回 PRICE_CHANGED" },
                    remark: { type: "string" },
                    addressConfirmed: { type: "boolean", description: "地址核对提示有问题（ADDRESS_CHECK）时确认无误继续出单" },
                    ...shipment.properties,
                  },
                },
              },
            },
          },
          responses: { 200: ok({ type: "object", properties: { created: { type: "boolean" }, order } }), 400: err, 402: err, 409: err, 422: err },
        },
        get: { tags: ["订单 Orders"], summary: "按 referenceNo 查单", parameters: [{ name: "referenceNo", in: "query", required: true, schema: { type: "string" } }], responses: { 200: ok(order), 404: err } },
      },
      "/orders/{no}": { get: { tags: ["订单 Orders"], summary: "查单（运单号、状态、面单是否已出）", parameters: [noParam], responses: { 200: ok(order), 404: err } } },
      "/orders/{no}/label": {
        get: {
          tags: ["订单 Orders"],
          summary: "下载面单（默认 PDF；format=base64 返回 JSON）",
          parameters: [noParam, { name: "format", in: "query", schema: { type: "string", enum: ["pdf", "base64"] } }],
          responses: { 200: { description: "PDF 文件，或 { fileName, fileType, content }" }, 404: err, 410: err },
        },
      },
      "/orders/{no}/cancel": { post: { tags: ["订单 Orders"], summary: "取消", parameters: [noParam], responses: { 200: ok({ type: "object", properties: { done: { type: "boolean" }, message: { type: "string" }, order } }), 409: err } } },
      "/balance": { get: { tags: ["账户 Account"], summary: "账户余额", responses: { 200: ok({ type: "object", properties: { balance: { type: "number" }, creditLimit: { type: "number" }, currency: { type: "string" } } }) } } },
    },
  };
}

/** 错误码说明（文档页用） */
export const API_ERRORS: [string, number, string, string][] = [
  ["UNAUTHORIZED", 401, "缺少密钥，或密钥无效 / 已作废", "Missing, invalid or revoked API key"],
  ["API_DISABLED", 403, "账户的 API 还没开通", "API access not enabled for this account"],
  ["IP_NOT_ALLOWED", 403, "请求 IP 不在这个密钥的白名单里", "Request IP not in the key's allow list"],
  ["RATE_LIMITED", 429, "调用太频繁（每个密钥每分钟 60 次），看 Retry-After", "Too many requests (60/min per key); see Retry-After"],
  ["INVALID_JSON", 400, "请求内容不是 JSON 对象", "Body is not a JSON object"],
  ["VALIDATION_ERROR", 400, "字段缺失或格式不对，message 里列出全部问题", "Missing or invalid fields; message lists all problems"],
  ["CHANNEL_UNAVAILABLE", 400, "渠道没开通，或这个地址 / 包裹不能用该渠道", "Channel not enabled or not available for this shipment"],
  ["NO_CHANNEL", 400, "没有可用渠道（例如国际件没开通国际渠道）", "No usable channel (e.g. international not enabled)"],
  ["TERMS_NOT_ACCEPTED", 403, "还没在客户中心同意服务条款", "Terms of service not yet accepted in the portal"],
  ["ADDRESS_CHECK", 422, "收件地址可能有问题；确认无误后加 addressConfirmed: true 重新提交", "Address may be wrong; resubmit with addressConfirmed: true if correct"],
  ["PRICE_CHANGED", 409, "价格和 expectedPrice 不一致，details.price 是当前价格", "Price differs from expectedPrice; details.price is current"],
  ["INSUFFICIENT_BALANCE", 402, "余额不足，请先充值", "Insufficient balance"],
  ["ORDER_FAILED", 400, "服务商拒单（message 里有原因），没有扣费", "Provider rejected the order (reason in message); not charged"],
  ["NOT_FOUND", 404, "订单不存在（测试密钥只能看到测试单）", "Order not found (test keys only see test orders)"],
  ["LABEL_NOT_READY", 404, "面单还在生成，稍后再取", "Label not ready yet; retry shortly"],
  ["LABEL_VOID", 410, "面单已取消作废", "Label was cancelled"],
  ["CANCEL_NOT_ALLOWED", 409, "当前状态或超过取消时限，不能取消", "Cannot cancel in this state or past the cancel window"],
  ["INTERNAL", 500, "服务器内部错误，稍后重试", "Internal error; retry later"],
];
