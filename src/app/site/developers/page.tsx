import Link from "next/link";
import { headers } from "next/headers";
import { getSettings } from "@/lib/db";
import { getLang } from "@/lib/prefs";
import { API_ERRORS } from "@/lib/api/openapi";
import { RATE_PER_MIN } from "@/lib/api/keys";
import { publicBase } from "@/lib/stores/web";
import SiteNav from "../SiteNav";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: `${getSettings().brandName} · API` };
}

/** 开放 API 文档（公开页面：给客户和客户的 ERP / OMS 技术人员看） */
export default async function DevelopersPage() {
  const s = getSettings();
  const en = (await getLang()) === "en";
  const L = (zh: string, e: string) => (en ? e : zh);
  const base = `${publicBase({ headers: await headers() })}/api/v1`;
  const key = "atr_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

  const rateReq = `curl -X POST ${base}/rates \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "shipTo": { "name": "Jane Roe", "phone": "5125550100", "address1": "500 Congress Ave",
                "city": "Austin", "state": "TX", "postalCode": "78701", "country": "US" },
    "package": { "length": 10, "width": 8, "height": 4, "weight": 1.5, "unit": "in/lb" }
  }'`;
  const rateRes = `{
  "success": true, "code": "OK", "message": "ok",
  "data": [
    { "channel": "SB-1234", "name": "UniUni Express", "carrier": "uniuni", "available": true, "price": 3.82, "currency": "USD", "zone": "zone3" },
    { "channel": "SB-2345", "name": "USPS Ground Advantage", "carrier": "usps", "available": true, "price": 5.64, "currency": "USD", "zone": "zone3" }
  ]
}`;
  const orderReq = `curl -X POST ${base}/orders \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "referenceNo": "SO-1001",
    "channel": "SB-1234",
    "shipTo": { "name": "Jane Roe", "phone": "5125550100", "address1": "500 Congress Ave",
                "city": "Austin", "state": "TX", "postalCode": "78701", "country": "US" },
    "package": { "length": 10, "width": 8, "height": 4, "weight": 1.5, "unit": "in/lb" },
    "items": [ { "sku": "TS-BLK-M", "name": "Cotton T-shirt", "quantity": 1, "unitValue": 12 } ]
  }'`;
  const orderRes = `{
  "success": true, "code": "OK", "message": "ok",
  "data": {
    "created": true,
    "order": {
      "orderNo": "ATR261001A1B2C3D4", "referenceNo": "SO-1001", "status": "labeled",
      "channel": "SB-1234", "channelName": "UniUni Express", "carrier": "uniuni",
      "trackingNo": "UUS0123456789", "trackingUrl": "https://…", "price": 3.82, "currency": "USD",
      "labelReady": true, "labelUrl": "${base}/orders/ATR261001A1B2C3D4/label", "test": true
    }
  }
}`;
  const labelReq = `# PDF
curl -H "Authorization: Bearer ${key}" -o label.pdf ${base}/orders/SO-1001/label
# base64 (JSON)
curl -H "Authorization: Bearer ${key}" "${base}/orders/SO-1001/label?format=base64"`;
  const errRes = en
    ? `{ "success": false, "code": "INSUFFICIENT_BALANCE", "message": "Insufficient balance: current balance 1.20, this order needs 3.82. Please top up." }`
    : `{ "success": false, "code": "INSUFFICIENT_BALANCE", "message": "余额不足：当前余额 1.20，本单需要 3.82，请先充值" }`;

  const endpoints: [string, string, string, string][] = [
    ["GET", "/channels", "账户可用的渠道（ERP“同步物流方式”用）", "Channels available to the account"],
    ["POST", "/rates", "运费试算：所有渠道或指定 channel，价格从低到高", "Rate quote for all or one channel, cheapest first"],
    ["POST", "/orders", "出单，返回单号、运单号、面单地址", "Create a label; returns order no., tracking no., label URL"],
    ["GET", "/orders/{no}", "查单（no 可以是 orderNo 或 referenceNo）", "Get an order (no = orderNo or referenceNo)"],
    ["GET", "/orders?referenceNo=…", "按你们的订单号查单", "Get an order by your reference no."],
    ["GET", "/orders/{no}/label", "下载面单 PDF；?format=base64 返回 JSON", "Download label PDF; ?format=base64 returns JSON"],
    ["POST", "/orders/{no}/cancel", "取消（规则同客户中心）", "Cancel (same rules as the portal)"],
    ["GET", "/balance", "账户余额", "Account balance"],
  ];
  const statuses: [string, string, string][] = [
    ["processing", "已下单，面单生成中", "Ordered, label being generated"],
    ["labeled", "面单已出，可打印", "Label ready to print"],
    ["cancelling", "取消处理中（服务商人工作废，完成后退款）", "Cancellation in progress (refund when done)"],
    ["cancelled", "已取消，费用已按规则退回", "Cancelled; refunded per policy"],
    ["exception", "出单异常（error 字段有原因）", "Exception (see error)"],
  ];

  return (
    <div className="site">
      <SiteNav brand={s.brandName} home={false} />
      <div className="site-wrap api-doc" style={{ padding: "48px 32px 80px", maxWidth: 960 }}>
        <h1 style={{ fontSize: 34, margin: "0 0 8px" }}>{s.brandName} API</h1>
        <p className="muted" style={{ margin: "0 0 24px" }}>
          {L(
            "通用的 REST + JSON 接口：任何系统（领星、马帮、店小秘、易仓等 ERP / OMS，或你们自己的系统）都能直接调用。报价、出单、取面单、查状态、取消，价格和规则与客户中心完全一致，费用从同一个账户余额扣。",
            "A standard REST + JSON API any system can call (ERPs / OMSs such as LingXing, or your own). Quote, create labels, download labels, track status and cancel — same prices, rules and balance as the customer portal.",
          )}
        </p>

        <div className="api-toc">
          {[["start", L("快速开始", "Quick start")], ["auth", L("鉴权与密钥", "Authentication")], ["endpoints", L("接口列表", "Endpoints")], ["fields", L("字段说明", "Fields")], ["status", L("订单状态", "Order status")], ["errors", L("错误码", "Error codes")], ["erp", L("ERP 对接说明", "ERP integration")]].map(([id, t]) => (
            <a key={id} href={`#${id}`}>{t}</a>
          ))}
          <a href="/site/developers/reference" className="api-toc-primary">{L("在线试调（接口参考）", "Interactive reference")} ↗</a>
          <a href="/api/v1/openapi.json" target="_blank">OpenAPI JSON ↗</a>
        </div>

        <section id="start">
          <h2>{L("快速开始", "Quick start")}</h2>
          <ol>
            <li>{L("登录客户中心 →「API 对接」，生成一个测试密钥（atr_test_…）。测试密钥出的都是模拟面单，不扣钱。", "In the customer portal open “API”, create a test key (atr_test_…). Test keys create simulated labels and are never charged.")}</li>
            <li>{L("用测试密钥把报价、出单、取面单、取消都调通。", "Get quoting, ordering, label download and cancel working with the test key.")}</li>
            <li>{L("换成正式密钥（atr_live_…）就是真实出单，按报价从余额扣费。", "Switch to a live key (atr_live_…) to buy real labels, charged to your balance.")}</li>
          </ol>
          <p><b>Base URL</b>：<code>{base}</code></p>
          <h3>1. {L("运费试算", "Get rates")}</h3>
          <pre>{rateReq}</pre>
          <pre>{rateRes}</pre>
          <h3>2. {L("出单", "Create a label")}</h3>
          <pre>{orderReq}</pre>
          <pre>{orderRes}</pre>
          <p className="small muted">{L("面单一般几秒内出好；如果返回的 status 是 processing、labelReady 是 false，过几秒再查 /orders/{no}。同一个 referenceNo 重复提交（例如网络超时重试）会直接返回已有的单（created: false），不会重复出单扣费。", "Labels are usually ready within seconds; if status is processing and labelReady is false, poll /orders/{no}. Re-submitting the same referenceNo (e.g. retry after a timeout) returns the existing order (created: false) — never a duplicate charge.")}</p>
          <h3>3. {L("下载面单", "Download the label")}</h3>
          <pre>{labelReq}</pre>
        </section>

        <section id="auth">
          <h2>{L("鉴权与密钥", "Authentication")}</h2>
          <ul>
            <li>{L("每个请求在请求头带上密钥：", "Send the key with every request:")} <code>Authorization: Bearer atr_live_…</code> {L("（也可以用", "(or")} <code>X-Api-Key: atr_live_…</code>{L("）", ")")}</li>
            <li>{L("密钥只在生成时显示一次，我们只保存加密后的摘要；泄露了请马上在客户中心作废，再生成新的。", "Keys are shown once at creation and stored only as a hash. If a key leaks, revoke it in the portal and create a new one.")}</li>
            <li>{L("可以给密钥设置 IP 白名单，只允许你们服务器的 IP 调用。", "Keys can be restricted to an IP allow list.")}</li>
            <li>{L(`频率限制：每个密钥每分钟 ${RATE_PER_MIN} 次，超过返回 429 和 Retry-After。`, `Rate limit: ${RATE_PER_MIN} requests per minute per key; over the limit returns 429 with Retry-After.`)}</li>
            <li>{L("只支持 HTTPS。所有返回都是 { success, code, message, data } 格式；失败时 success 为 false，code 见下面的错误码。", "HTTPS only. Every response is { success, code, message, data }; on failure success is false and code is one of the error codes below.")}</li>
          </ul>
          <pre>{errRes}</pre>
        </section>

        <section id="endpoints">
          <h2>{L("接口列表", "Endpoints")}</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {endpoints.map(([m, p, zh, e]) => (
                  <tr key={m + p}><td><span className={`api-m ${m.toLowerCase()}`}>{m}</span></td><td><code>{p}</code></td><td>{L(zh, e)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="fields">
          <h2>{L("字段说明", "Fields")}</h2>
          <h3>shipTo / shipFrom</h3>
          <p>{L("name（或 firstName + lastName）、phone、address1、address2、city、state（美国填州二字码）、postalCode、country（二字码，默认 US）、company、email。shipFrom 不传时用账户的默认寄件地址。", "name (or firstName + lastName), phone, address1, address2, city, state (2-letter for US), postalCode, country (2-letter, default US), company, email. shipFrom defaults to the account's sender address.")}</p>
          <h3>package</h3>
          <p>{L("length、width、height、weight，unit 为 in/lb（默认）、cm/kg 或 cm/g；signature：none（默认）、direct、indirect、adult。", "length, width, height, weight; unit is in/lb (default), cm/kg or cm/g; signature: none (default), direct, indirect, adult.")}</p>
          <h3>items</h3>
          <p>{L("sku、name（英文品名）、quantity、unitValue（单件申报价值 USD）。国际件还要 hsCode、originCountry、material。美国件不传 items 时按一件普通货物处理；传了 SKU 会按账户设置加印在面单上。", "sku, name, quantity, unitValue (USD per unit). International shipments also need hsCode, originCountry and material. US shipments may omit items; SKUs are printed on the label per account settings.")}</p>
          <h3>{L("出单的其他字段", "Other order fields")}</h3>
          <p>{L("referenceNo（必填，你们的订单号，最长 50 位）、channel（必填）、expectedPrice（可选：报价时的价格，价格变了会返回 PRICE_CHANGED）、remark、addressConfirmed（地址核对提示有问题时确认无误继续出单）。", "referenceNo (required, your order no., max 50), channel (required), expectedPrice (optional; PRICE_CHANGED if the price moved), remark, addressConfirmed (proceed after an ADDRESS_CHECK warning).")}</p>
        </section>

        <section id="status">
          <h2>{L("订单状态", "Order status")}</h2>
          <div className="table-wrap"><table><tbody>{statuses.map(([k, zh, e]) => <tr key={k}><td><code>{k}</code></td><td>{L(zh, e)}</td></tr>)}</tbody></table></div>
        </section>

        <section id="errors">
          <h2>{L("错误码", "Error codes")}</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>code</th><th>HTTP</th><th>{L("说明", "Meaning")}</th></tr></thead>
              <tbody>{API_ERRORS.map(([c, h, zh, e]) => <tr key={c}><td><code>{c}</code></td><td>{h}</td><td>{L(zh, e)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <section id="erp">
          <h2>{L("ERP 对接说明（领星等）", "ERP integration (LingXing etc.)")}</h2>
          <ul>
            <li>{L("物流商授权：在 ERP 里填我们的密钥（API Key / Token 一栏），接口地址填上面的 Base URL。", "Provider authorization: enter the API key in the ERP's API Key / Token field and the Base URL above.")}</li>
            <li>{L("同步物流方式：调用 /channels，channel 是渠道代码，name 是显示名称。", "Sync shipping methods: call /channels (channel = code, name = display name).")}</li>
            <li>{L("下单获取面单：/orders 出单，referenceNo 填 ERP 的订单号或包裹号；面单用 /orders/{no}/label?format=base64。", "Order & label: create with /orders (referenceNo = ERP order / package no.), then fetch /orders/{no}/label?format=base64.")}</li>
            <li>{L("获取运单号：出单返回里就有 trackingNo；如果还是空的，过几秒调 /orders/{no}。", "Tracking no.: returned on create; if empty, poll /orders/{no}.")}</li>
            <li>{L("取消 / 截单：/orders/{no}/cancel。", "Cancel: /orders/{no}/cancel.")}</li>
            <li>{L("ERP 厂商需要对接资料或测试账号，请联系我们：", "ERP vendors needing integration support or a test account, contact us:")} {s.supportContact || <Link href="/site/contact">{L("联系我们", "Contact")}</Link>}</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
