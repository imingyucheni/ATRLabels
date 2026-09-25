/** 后台：布局 / 概览 / 设置 / 客户 / 运费试算 / 登录 / 加印设置等 */
export const admin1: Record<string, string> = {
  /* ---------- 布局 / 菜单 ---------- */
  "ATR 面单系统 · 后台": "ATR Labels · Admin",
  "管理后台": "Admin",
  "管理后台 · 版本 {v}": "Admin · v{v}",
  "模拟模式 · 按报价表计算（{n} 个渠道）": "Demo (mock) mode · priced from rate tables ({n} services)",
  "模拟模式 · 还没导入报价表，运费是粗略估算": "Demo (mock) mode · no rate tables imported, postage is a rough estimate",
  "概览": "Overview",
  "客户管理": "Customers",
  "运费试算": "Rate Quote",
  "财务 · 充值审核": "Finance · Top-ups",
  "补差导入": "Adjustment Import",
  "派送范围与价格": "Coverage & Pricing",
  "系统": "System",
  "设置": "Settings",

  /* ---------- 概览 ---------- */
  "有 {n} 笔客户充值待确认，": "{n} customer top-ups awaiting confirmation. ",
  "去处理": "Review now",
  "还没有同步物流渠道，请先到": "No shipping services synced yet. Go to",
  "点“同步渠道”，并设置默认寄件地址和加价规则。": "and click “Sync services”, then set the default sender address and markup rules.",
  "含面单生成中 {n} 单": "incl. {n} generating",
  "今日收入": "Today's revenue",
  "今日利润": "Today's profit",
  "本月利润": "Month profit",
  "需要处理（{n}）": "Needs attention ({n})",
  "暂无记录": "No records yet",
  "金额币种以 ShipBest 返回为准（{cur}）。": "Currency as returned by ShipBest ({cur}).",

  /* ---------- 设置：ShipBest 连接 ---------- */
  "ShipBest 连接": "ShipBest connection",
  "当前：模拟模式（价格是模拟的）": "Current: demo (mock) mode (simulated prices)",
  "当前：正式模式": "Current: live mode",
  "现在是": "You are in ",
  "模拟模式": "demo (mock) mode",
  "：报价和面单都是系统模拟的，不会调用 ShipBest，价格和 OMS 里的真实价格对不上。":
    ": quotes and labels are simulated without calling ShipBest, so prices won't match the real OMS prices.",
  "填好 API ID 和 Token、选“正式”后保存，再点“同步渠道”，就会用真实价格和真实出单。":
    "Enter the API ID and Token, choose “Live” and save, then click “Sync services” to use real prices and create real labels.",
  "模式": "Mode",
  "正式（真实报价、真实出单扣费）": "Live (real quotes, real labels and charges)",
  "模拟（测试用，不会真实出单）": "Mock (for testing, no real labels)",
  "OMS 后台 → API 配置里的 ID": "ID from OMS → API settings",
  "已保存（尾号 {tail}），留空不修改": "Saved (ends in {tail}); leave blank to keep",
  "OMS 后台 → API 配置里的 Token": "Token from OMS → API settings",
  "保存并测试连接": "Save & test",
  "切换模式或更换账号会影响所有客户的报价和出单": "Switching mode or account affects quotes and labels for all customers",
  "确定修改 ShipBest 连接吗？切到“正式”后所有客户下单都会真实出单扣费。":
    "Change the ShipBest connection? In “Live” mode, every customer order creates real labels and real charges.",
  "测试连接": "Test connection",
  "同步渠道": "Sync services",

  /* ---------- 设置：加价 / 取消 / 补差 / 余额 ---------- */
  "保存设置": "Save settings",
  "修改会影响所有客户的价格和余额规则": "Changes affect prices and balance rules for all customers",
  "加价、取消费、补差和余额规则会对所有客户生效，确定保存吗？":
    "Markup, cancellation fees, adjustments and balance rules apply to all customers. Save?",
  "全局加价规则": "Global markup rules",
  "客户价 = max(成本 × (1 + 加价%) + 固定加价, 成本 + 最低利润)，再按取整步长向上取整。":
    "Customer price = max(cost × (1 + markup%) + fixed markup, cost + minimum profit), rounded up to the rounding step.",
  "优先级：客户专属设置 > 渠道设置 > 全局默认（按字段逐项覆盖）。成本 = ShipBest 试算的“优惠后总运费”。":
    "Priority: customer settings > service settings > global defaults (overridden field by field). Cost = ShipBest's quoted “total after discount”.",
  "取整步长": "Rounding step",
  "0.01（不取整）": "0.01 (no rounding)",
  "示例：": "Examples: ",
  "成本 {cost} → 客户价 {price}": "cost {cost} → customer price {price}",
  "取消订单": "Cancellations",
  "向客户收取手续费 %": "Customer cancellation fee %",
  "ShipBest 收取取消费 %": "ShipBest cancellation fee %",
  "客户取消费按客户价计算，ShipBest 取消费按我们的成本计算；只有已出面单的订单才收取。确认取消时可以手动修改。":
    "The customer fee is based on the customer price and the ShipBest fee on our cost; both apply only to orders with a label. You can edit them when confirming a cancellation.",
  "官方账单补差（多退少补）": "Carrier bill adjustments (charge or refund the difference)",
  "补差如何转嫁给客户": "How adjustments are passed to customers",
  "ShipBest 扣的是预报价，官方账单出来后按重量或分区差异多退少补。在“补差导入”上传他们的表格时，按这里的规则计算向客户补收或退还的金额（导入时的规则会记录在批次上）。":
    "ShipBest charges the declared price, then bills or refunds weight or zone differences once the carrier bill arrives. When you upload their file in “Adjustment Import”, the amount charged or refunded to the customer follows this rule (the rule at import time is saved on the batch).",
  "客户余额与充值": "Customer balance & top-ups",
  "下单余额规则": "Balance rule for orders",
  "余额大于 0 即可下单（这一单可以让余额变负，余额 ≤ 0 时必须充值）":
    "Allow orders while balance is above 0 (an order may take it negative; top-up required at ≤ 0)",
  "余额必须够付这一单才能下单": "Balance must cover the order",
  "月结客户可以在客户页面设置信用额度：可用余额 = 余额 + 信用额度。后台代客户下单也按这个规则检查。收款方式在下方“收款方式”里设置。":
    "For monthly-billed customers, set a credit limit on the customer page: available = balance + credit limit. Orders placed by admin on a customer's behalf are checked the same way. Payment methods are set under “Payment methods” below.",
  "客户端": "Customer portal",
  "客户端显示的公司名称": "Company name shown in portal",
  "客服联系方式（显示在客户端）": "Support contact (shown in portal)",
  "例如：微信 xxx / 邮箱 support@xxx.com": "e.g. WeChat xxx / email support@xxx.com",
  "客户登录地址：": "Customer login URL: ",
  "。在“客户”页面给客户开通登录。": ". Enable customer logins on the “Customers” page.",
  "默认值": "Defaults",
  "默认单位": "Default units",
  "lb / in（英制）": "lb / in (imperial)",
  "默认币种": "Default currency",

  /* ---------- 设置：收款方式 / 汇率 ---------- */
  "保存收款设置": "Save payment settings",
  "客户充值页会显示这里的收款账号": "These payment accounts are shown on the customer top-up page",
  "客户会按这里的信息付款，请再核对一遍收款账号。确定保存吗？":
    "Customers will pay using these details. Please double-check the accounts. Save?",
  "收款方式（客户充值）": "Payment methods (customer top-ups)",
  "客户在客户端“充值”页选择 Zelle（美元）或支付宝（人民币）付款，上传凭证后提交申请；你们在“财务”页确认到账后自动加到客户余额。余额以美元记账。":
    "Customers pay via Zelle (USD) or Alipay (CNY) on the portal “Top Up” page and submit a request with proof; once you confirm receipt on the “Finance” page, it's added to their balance. Balances are kept in USD.",
  "Zelle 收款信息（显示给客户）": "Zelle payment details (shown to customers)",
  "邮箱 / 电话：pay@example.com\n户名：ATR Logistics LLC": "Email / phone: pay@example.com\nName: ATR Logistics LLC",
  "支付宝收款信息（显示给客户）": "Alipay payment details (shown to customers)",
  "支付宝账号：xxx@xxx.com\n户名：某某": "Alipay account: xxx@xxx.com\nName: ...",
  "支付宝收款码图片（PNG / JPG，可选）": "Alipay QR code image (PNG / JPG, optional)",
  "：已上传，重新选择可替换": ": uploaded, choose a new file to replace",
  "人民币汇率": "CNY exchange rate",
  "汇率来源": "Rate source",
  "当天实时汇率 + 加点（推荐）": "Daily live rate + markup (recommended)",
  "固定汇率 + 加点": "Fixed rate + markup",
  "实时汇率更新频率": "Live rate refresh",
  "每天一次（全天固定，推荐）": "Once a day (fixed all day, recommended)",
  "每小时": "Hourly",
  "加点（加在汇率上，例如 0.03）": "Markup (added to the rate, e.g. 0.03)",
  "固定 / 备用汇率": "Fixed / fallback rate",
  "当前：": "Current: ",
  "实时汇率 {live}（{source}）": "live rate {live} ({source})",
  "，取于 {time}": ", fetched {time}",
  "+ 加点 {m} =": "+ markup {m} =",
  "充值汇率 {rate}": "top-up rate {rate}",
  "（充 100 美元需付 ¥{cny}）": " ($100 top-up costs ¥{cny})",
  " · {d} 今日汇率": " · {d} daily rate",
  "（最近一次）": " (last known)",
  "手动设置": "Manual",
  "备用汇率（实时汇率获取失败）": "Fallback rate (live rate unavailable)",
  "自动更新，不需要手动操作：选“每天一次”时，每天（美西时间）第一次有人打开充值页时取当天的实时汇率，当天之内固定不变；选“每小时”则每小时更新一次。":
    "Updates automatically: with “Once a day”, the live rate is fetched the first time someone opens the top-up page each day (US Pacific time) and stays fixed for that day; with “Hourly”, it updates every hour.",
  "来源 ExchangeRate-API，备用欧洲央行数据；获取失败时用最近一次的汇率，再不行用上面的备用汇率。点“立即更新汇率”可以马上重新获取今天的汇率。":
    "Source: ExchangeRate-API, with ECB data as backup. If fetching fails, the last known rate is used, then the fallback rate above. Click “Refresh rate now” to re-fetch today's rate immediately.",
  "充值页其他说明（可选）": "Extra top-up instructions (optional)",
  "例如：转账备注请写公司名；工作日 2 小时内确认到账": "e.g. Put your company name in the transfer memo; confirmed within 2 hours on business days",
  "立即更新汇率": "Refresh rate now",

  /* ---------- 设置：物流渠道 ---------- */
  "保存渠道设置": "Save service settings",
  "开关渠道、改渠道加价会影响所有客户": "Enabling services or changing service markups affects all customers",
  "渠道设置会对所有客户生效，确定保存吗？": "Service settings apply to all customers. Save?",
  "物流渠道": "Shipping services",
  "这里是总开关：取消勾选的渠道所有客户都不能用。每个客户具体能用哪些渠道，在“客户”详情里单独开通（新客户默认不开通）。加价留空 = 沿用全局设置。":
    "This is the master switch: unchecked services are unavailable to all customers. Enable services per customer on the customer's page (none by default for new customers). Blank markup = use global settings.",
  "启用": "Enabled",
  "固定加价": "Fixed markup",
  "最低利润": "Min. profit",
  "成本 10.00 时客户价": "Price at cost 10.00",
  "开通客户": "Customers",
  "还没有渠道，请点上方“同步渠道”": "No services yet. Click “Sync services” above",
  "默认 {v}": "Default {v}",

  /* ---------- 面单加印 SKU ---------- */
  "面单加印 SKU": "SKU stamp on labels",
  "这个渠道所有客户的面单都会按新位置加印，确定保存吗？":
    "Labels for all customers on this service will be stamped at the new position. Save?",
  "加印设置会用于所有客户的面单（客户单独设置的除外），确定保存吗？":
    "Stamp settings apply to all customers' labels (except customers with their own setting). Save?",
  "请填 {min}–{max}": "Enter {min}–{max}",
  "面单出来后，打印 / 下载 / 合并打印时自动在指定位置印上这一单的 SKU（原始面单不改动，面单详情页可以下载原始版本）。":
    "When a label is printed, downloaded or merge-printed, the order's SKU is stamped at the set position (the original label is unchanged and can be downloaded from the label page).",
  "不同渠道的面单版式不同，可以选择渠道单独开关、调整位置。位置按 4×6 英寸面单计算：距左边、距上边多少英寸。":
    "Label layouts differ by service, so you can turn stamping on/off and adjust its position per service. Position is measured on a 4×6 in label: inches from the left and top edges.",
  "目前 UniUni、GOFO、SwiftX 等渠道的面单，ShipBest 已经在备注 / Remarks 里印了 SKU，不需要加印；":
    "Labels for UniUni, GOFO, SwiftX and similar services already show the SKU in the Remarks field, so no stamp is needed. ",
  "USPS 面单没有这一栏，默认只给 USPS 加印": "USPS labels have no such field, so only USPS is stamped by default",
  "位置在最下面一栏左侧空白（条码框下方、右下角二维码左边）。":
    "in the blank area at the left of the bottom row (below the barcode box, left of the QR code).",
  "请把文字放在面单的空白处，": "Place the text in a blank area of the label. ",
  "不要盖住条码、运单号和地址": "Don't cover the barcode, tracking number or addresses",
  "（尤其开启白底时），否则承运商可能无法扫描。每个渠道设置后先用预览确认。":
    " (especially with a white background), or the carrier may fail to scan it. Check the preview after setting each service.",
  "正在编辑": "Editing",
  "全局默认": "Global default",
  "渠道：": "Service: ",
  "（加印）": " (stamp)",
  "（不加印）": " (no stamp)",
  "（已单独设置）": " (custom)",
  "所有渠道默认加印": "Stamp all services by default",
  "这个渠道": "This service",
  "跟随全局（{v}）": "Follow global ({v})",
  "加印": "stamp",
  "不加印": "No stamp",
  "加印 SKU": "Stamp SKU",
  "不加印（面单上已有 SKU）": "No stamp (label already shows SKU)",
  "距左边（英寸）": "From left (in)",
  "距上边（英寸）": "From top (in)",
  "字号（pt）": "Font size (pt)",
  "最大宽度（英寸）": "Max width (in)",
  "文字方向": "Text direction",
  "横向 0°": "Horizontal 0°",
  "逆时针 90°": "90° counterclockwise",
  "顺时针 90°": "90° clockwise",
  "文字内容": "Text content",
  "前缀": "Prefix",
  "多个 SKU 分隔符": "SKU separator",
  "最多行数": "Max lines",
  "数量大于 1 时显示 “x数量”": "Show “xQty” when quantity is over 1",
  "文字加白底": "White background",
  "粗体": "Bold",
  "只能印英文、数字和常见符号（面单打印机字体限制），中文会显示成 “?”。每张面单也可以在详情页单独填写要印的文字。":
    "Only English letters, digits and common symbols can be printed (label font limits); Chinese shows as “?”. You can also set custom stamp text on each label's page.",
  "留空的项跟随全局默认。": "Blank fields follow the global default.",
  "上传该渠道的示例面单": "Upload a sample label for this service",
  "：从 ShipBest 后台下载一张这个渠道的面单（PDF / PNG），上传后预览就用它，按真实版式找空白位置。":
    ": download a label for this service from ShipBest (PDF / PNG) and upload it; the preview then uses it so you can find a blank area on the real layout.",
  "上传": "Upload",
  "保存该渠道位置": "Save service position",
  "保存加印设置": "Save stamp settings",
  "预览": "Preview",

  /* ---------- 客户列表 ---------- */
  "客户申请重置密码（{n}）": "Password reset requests ({n})",
  "没有配置邮件发送时，由这里生成新密码后告诉客户": "Without email configured, generate a new password here and send it to the customer",
  "生成新密码": "New password",
  "为这个客户生成新密码？旧密码会失效。": "Generate a new password for this customer? The old password will stop working.",
  "＋ 新增客户": "+ New customer",
  "名称": "Name",
  "联系人": "Contact",
  "未开通": "Not enabled",
  "{n} 个": "{n}",
  "进入 OMS ↗": "Open OMS ↗",
  "管理": "Manage",
  "还没有客户，先新增一个": "No customers yet. Add one first",
  "“默认”表示沿用渠道或全局设置（当前全局：+{p}%，固定 {f}，最低利润 {m}）。":
    "“Default” means the service or global setting applies (current global: +{p}%, fixed {f}, min. profit {m}).",

  /* ---------- 客户详情 ---------- */
  "当前加印：{list}": "stamped: {list}",
  "当前都不加印": "none stamped",
  "编辑客户：{name}": "Edit customer: {name}",
  "新增客户": "New customer",
  "进入客户 OMS ↗": "Open customer OMS ↗",
  "创建客户并生成登录信息": "Create customer & login",
  "邮箱（客户 OMS 登录账号）": "Email (customer OMS login)",
  "专属加价（留空 = 沿用渠道 / 全局设置）": "Custom markup (blank = use service / global settings)",
  "可用额度": "Available",
  "客户端登录": "Portal login",
  "已开通": "Enabled",
  "未设密码": "No password",
  "保存渠道": "Save services",
  "可用渠道": "Available services",
  "已开通 {n} 个": "{n} enabled",
  "未开通，客户无法下单": "None enabled, customer can't ship",
  "新客户默认不开通任何渠道。勾选后客户才能用这些渠道查询运费、下单和批量导入；后台代下单也只能用这里开通的渠道。":
    "New customers have no services by default. Check services to let the customer get rates, create labels and bulk import with them; orders placed on their behalf are limited to these services too.",
  " · 设置里已停用，暂不可用": " · disabled in Settings, unavailable",
  "还没有渠道，请先到": "No services yet. Go to",
  "同步渠道。": "to sync services.",
  "确认": "Confirm",
  "确认提交这笔充值 / 调账？提交后会立即计入客户余额。":
    "Submit this top-up / adjustment? It's applied to the customer's balance immediately.",
  "充值 / 调账": "Top-up / adjustment",
  "充值（客户付款到账）": "Top-up (payment received)",
  "手动调账（正数加、负数扣）": "Manual adjustment (+ add, − deduct)",
  "例如：9月转账 / 赔偿 / 月结账单": "e.g. Sept transfer / compensation / monthly bill",
  "保存登录设置": "Save login settings",
  "允许客户登录": "Allow customer login",
  "信用额度：余额可以透支到负多少。预付客户填 0；月结客户填一个额度。后台代客户下单也按这个额度检查。":
    "Credit limit: how far the balance may go negative. Enter 0 for prepaid customers or a limit for monthly-billed ones. Orders placed on the customer's behalf are checked against it too.",
  "重新生成密码": "Reset password",
  "生成登录密码": "Generate password",
  "新密码（至少 8 位；留空自动生成）": "New password (min. 8 chars; blank = auto-generate)",
  "把下面的地址和登录邮箱、密码发给客户，客户在自己的 OMS 里下单、充值、查看记录：":
    "Send this URL with the login email and password to the customer to ship, top up and view records in their own OMS:",
  "这个客户的面单": "This customer's labels",
  "跟随系统设置（{s}）": "Follow system ({s})",
  "位置和样式在“设置 → 面单加印 SKU”里调整。": "Set position and style under “Settings → SKU stamp on labels”.",
  "保存寄件地址": "Save sender address",
  "客户默认寄件地址": "Customer default sender address",
  "留空则使用系统默认寄件地址。客户也可以在客户端自己修改。":
    "Leave blank to use the system default sender address. Customers can also change it in the portal.",
  "账户流水（最近 100 条）": "Account activity (last 100)",
  "后台": "Admin",
  "还没有流水": "No activity yet",

  /* ---------- 开户信息 ---------- */
  "您好，{name}：\n您的 {brand} 账号已开通，可以登录下单、充值和查看记录。\n登录地址：{url}\n登录邮箱：{email}\n初始密码：{password}\n登录后请在“账户设置”里修改密码。":
    "Hello {name},\nYour {brand} account is ready. You can log in to create labels, top up and view records.\nLogin URL: {url}\nLogin email: {email}\nInitial password: {password}\nPlease change your password under “Settings” after logging in.",
  "开户信息（发给客户）": "Account details (send to customer)",
  "已复制 ✓": "Copied ✓",
  "复制开户信息": "Copy details",
  "已发送，隐藏": "Sent, hide",
  "密码只在这里显示 15 分钟（系统只保存加密后的密码）。过期或忘记了，可以在下方“客户端登录”里重新生成。":
    "The password is shown here for 15 minutes only (only a hash is stored). If it expires or is lost, generate a new one under “Portal login” below.",

  /* ---------- 对账单 / 扣款明细 ---------- */
  "对账单：{name}": "Statement: {name}",
  "← 客户列表": "← Customers",
  "面单费用": "Label charges",
  "这个期间没有记录": "No records in this period",
  "面单按创建日期统计；补差按导入日期统计（补差对应的面单可能是之前月份的）。金额为负表示退给客户。":
    "Labels are counted by creation date; adjustments by import date (their labels may be from earlier months). Negative amounts are refunds to the customer.",
  "扣款明细：{name}": "Charges: {name}",
  "← 客户管理": "← Customer",
  "订单号 / 运单号": "Order ref / tracking no.",

  /* ---------- 运费试算 ---------- */
  "只试算、不出单。可以按新客户临时设的加价试算所有渠道，也可以选已有客户看他实际的价格。":
    "Quotes only, no labels. Quote all services with a temporary markup for a new customer, or pick an existing customer to see their actual prices.",
  "出单在客户自己的 OMS 里进行（需要代客户出单时，在“客户管理”点“进入 OMS”）。":
    "Labels are created in the customer's own OMS (to ship on their behalf, click “Open OMS” under “Customers”).",
  "没有启用的渠道，请先到": "No services enabled. Go to",

  /* ---------- 后台登录 ---------- */
  "登录 · ATR 面单系统": "Log in · ATR Labels",
  "尾程面单，一处管理": "Last-mile labels, all in one place",
  "报价、出单、补差、客户钱包与报表。": "Quotes, labels, adjustments, customer wallets and reports.",
  "多渠道实时比价，按规则自动加价": "Live rate comparison across services with rule-based markup",
  "批量导入 ShipBest 导单表，一键合并打印": "Bulk import ShipBest order sheets and merge-print in one click",
  "官方账单补差自动对应到客户": "Carrier bill adjustments matched to customers automatically",
  "使用后台密码登录": "Log in with the admin password",
  "后台密码": "Admin password",
};
