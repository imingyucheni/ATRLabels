# ATR 面单系统

对接 **ShipBest OMS**（`https://oms.shipbest.com`）的内部后台：给客户试算尾程运费、按我们的成本加价报价、下单出 4×6 面单，并记录每一单的成本、客户价和利润，方便对账。

## 功能

- **报价**：一次试算所有启用的渠道，列出 ShipBest 原价、我们的成本（优惠后总运费）、客户价和利润。
- **加价规则**：`客户价 = max(成本 × (1 + 加价%) + 固定加价, 成本 + 最低利润)`，再按步长向上取整（0.01 / 0.05 / 0.1 / 0.5 / 1）。
  - 可以分三级设置：**客户专属 > 渠道 > 全局默认**，按字段逐项覆盖（例如客户只设置了加价 %，固定加价和最低利润仍沿用上一级）。
- **出单**：下单前会重新试算一次，价格有变化会提示员工重新确认。出单后自动轮询 ShipBest，拿到面单后**立即下载保存到本地**（防止 ShipBest 的链接过期），可以在线打印或下载。
- **取消**：先尝试走接口取消（未出单的订单通常可以直接取消）。已出面单的订单接口不支持时，会标记为“取消处理中”；员工在 OMS 联系 ShipBest 人工取消后，再点“确认已取消”并填写费用：
  - 向客户收取的取消手续费（默认客户价的 10%）
  - ShipBest 收取的取消费（默认成本的 10%）
  - 系统自动算出应退客户的金额和利润。
- **对账**：面单列表可以按客户、状态、日期筛选，显示成本、应收和利润合计，支持导出 CSV（Excel 直接打开，中文不乱码）。成本优先用 ShipBest 的实扣金额，没有实扣时用试算成本。
- **概览**：今日和本月的出单数、收入、利润，以及需要处理的单（等待出单、异常、取消处理中）。
- **登录**：后台用一个共享密码登录。

余额在 OMS 后台查看（ShipBest 接口没有余额查询）。余额不足时下单会报错 `11200`，系统会提示“OMS 账户余额不足，请先充值”。

## 快速开始

需要 Node.js 20 或以上版本。

```bash
npm install
cp .env.example .env.local   # 填写配置，见下文
npm run build
npm start                    # 默认端口 3000
```

开发模式：`npm run dev`。

### 环境变量

| 变量 | 说明 |
|---|---|
| `SHIPBEST_API_ID` / `SHIPBEST_ACCESS_TOKEN` | 在 OMS 后台的 API 配置里获取 |
| `SHIPBEST_BASE_URL` | 默认 `https://oms.shipbest.com` |
| `SHIPBEST_MOCK` | 设为 `1` 时使用模拟数据，不调用真实接口，适合先试用界面 |
| `ADMIN_PASSWORD` | 后台登录密码 |
| `SESSION_SECRET` | 会话签名密钥，至少 16 个字符的随机字符串 |
| `DATA_DIR` | 数据目录，存放 SQLite 数据库和面单文件，默认 `./data`。**请定期备份这个目录** |

### 首次使用

1. **设置 → 测试连接**：确认 apiId 和 token 有效（签名正确）。
2. **设置 → 同步渠道**：从 ShipBest 拉取我们账号能用的物流产品，勾选要对客户开放的渠道。
3. **设置**：填写全局加价规则、取整步长、取消费比例、默认寄件地址（发货仓）。
4. **客户 → 新增客户**：需要时给客户单独设置加价。
5. **新建面单**：选择客户，填写收件人、包裹和商品明细，点“试算所有渠道”，再选一个渠道出单。

## 部署建议

- 部署在一台常驻的服务器或 VPS 上（例如 `npm start` 配合 pm2 或 systemd），前面用 Nginx 或 Caddy 加上 HTTPS。
- 数据存在 `DATA_DIR`（SQLite 数据库和面单 PDF），不要部署到没有持久磁盘的无服务器平台。
- 如果 ShipBest 对 API 调用有 IP 白名单，要把服务器出口 IP 报给他们。

## ShipBest 接口说明（整理自其 Apifox 文档）

所有接口都是 POST，参数用 JSON 放在请求体里。请求头要带 `apiId`、`accessToken`、`timestamp`（毫秒）、`nonce`、`sign`。

签名方法：把 `accessToken, apiId, method=post, nonce, timestamp, url=接口路径` 这 6 项按名字排序，用 `&` 连接，再用 accessToken 作密钥做 HmacSHA256，输出十六进制。实现见 `src/lib/shipbest/sign.ts`。

| 接口 | 路径 | 系统中的用途 |
|---|---|---|
| 授权校验 | `/api/oauth/verify` | 设置页“测试连接” |
| 物流产品 | `/api/logistics/getProducts` | 同步渠道 |
| 运费试算 | `/api/logistics/trialOrderPrice` | 报价（按渠道 code 逐个试算，因为返回结果里不带 code） |
| 创建订单 | `/api/order/create` | 出单，`customNo` 由系统生成（格式 `ATR` + 日期 + 随机串） |
| 订单详情 | `/api/order/detail` | 取状态、运单号、`labelUrl`、实扣 `feePrice` |
| 订单取消 | `/api/order/cancel` | 申请取消 |

ShipBest 订单状态：1 草稿、2 待出单、3 异常、4 已打单、6 已取消。

### 待和 ShipBest 确认的问题

- 文档里的示例签名 `9bc08ba7…` 用文档给出的两组示例参数都算不出来，示例本身前后不一致。请先用“测试连接”实测。
- `totalDiscountShippingFee`（优惠后总运费）是否就是最终结算价？在什么情况下会和实扣 `feePrice` 不同？
- 创建订单接口的返回内容（文档里是 `{}`）。目前系统按“异步出单、轮询订单详情”来处理。
- `declaredUnitPrice` 文档写的是整数类型，小数申报价会不会被截断？
- 接口调用频率的具体上限（超出时返回错误码 11005）。

## 开发

```bash
npm test        # 单元测试 + 模拟模式完整流程测试
npm run lint    # TypeScript 类型检查
```

目录结构：

```
src/lib/shipbest/   ShipBest 签名、接口客户端（真实接口和模拟接口）
src/lib/pricing.ts  加价计算
src/lib/db.ts       SQLite 表结构和数据访问
src/lib/service.ts  业务流程：报价、出单、刷新状态、取消
src/app/            页面（Next.js App Router）和 Server Actions
```
