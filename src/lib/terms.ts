/**
 * 客户服务条款：客户第一次登录（以及条款有重要修改、版本号变了之后）必须勾选同意才能使用客户中心。
 * 每次同意都记下版本、时间、IP，后台客户详情里可以查。
 */
import { db, getSettings, saveSettings, type Customer } from "./db";

export const DEFAULT_TERMS_ZH = `本服务条款由 {brand}（以下简称“我们”）与 {customer}（以下简称“您”）签订。请仔细阅读以下条款，填写签署人并勾选同意后即可开始使用。

一、账户使用
1. 账户仅限您本人或贵公司使用，请妥善保管登录密码；通过您的账户下的订单均视为您本人的操作。
2. 账户采用预付余额，按单扣费；余额不足时不能下单。充值在我们确认到账后入账。

二、如实申报货物
1. 请如实、准确填写收件人信息、包裹重量、尺寸、品名、数量和申报价值。
2. 禁止寄送违禁品及承运商禁运物品，包括但不限于：易燃易爆品、危险化学品、未按规定包装的锂电池、武器及仿真武器、毒品、现金及有价证券、活体动植物等。
3. 因申报不实、违禁品或包装不当造成的扣件、退件、销毁、罚款及其他费用，由您承担；造成承运商或我们损失的，您需承担赔偿责任。

三、重量、尺寸与补差
1. 运费按下单时您填写的重量和尺寸计算。
2. 承运商会复核包裹的实际重量和体积重量（以两者较大者计费）。复核结果与填写不一致、或分区有差异时，我们会按承运商账单向您补收（或退还）差价，按您账户的价格规则计算。
3. 每一笔补差都会在账户“补差明细”中逐单列明，并从账户余额中扣除或退回。

四、收件地址
1. 请确保收件地址完整、准确（包括公寓号 / 单元号）。系统的地址核对仅供参考。
2. 因地址错误或不完整产生的改派、退件等费用由您承担。

五、取消与退款
1. 下单后 {cancelHours} 小时内可以申请取消：未出面单的全额退回余额；已出面单的按规定收取取消手续费。
2. 超过取消时限、已经使用或已被承运商扫描的面单不能取消退款。

六、时效与理赔
1. 页面显示的派送时效为承运商的参考时效，不作保证；承运商延误、天气、节假日等造成的延迟不属于我们的责任。
2. 包裹丢失或损坏，按承运商的理赔规定处理，我们协助您向承运商申请理赔；除另行购买保险外，赔偿以承运商实际赔付为准。

七、其他
1. 运费价格和可用渠道可能随承运商调整而变化，以下单时显示的价格为准。
2. 收件人信息仅用于出单和派送，我们不会用于其他用途。
3. 条款如有重要修改，会在您登录时提示，需要重新同意后继续使用。

如有疑问，请联系客服。`;

export const DEFAULT_TERMS_EN = `These Terms of Service are between {brand} ("we") and {customer} ("you"). Please read them carefully, enter the signer's details and accept to start using your account.

1. Your account
1.1 Your account is for you or your company only. Keep your password safe; orders placed through your account are treated as placed by you.
1.2 Accounts are prepaid and charged per label. You cannot ship when your balance is insufficient. Top-ups are credited once we confirm receipt.

2. Accurate declarations
2.1 Provide accurate recipient details, package weight, dimensions, item descriptions, quantities and declared values.
2.2 Prohibited and carrier-restricted items may not be shipped, including but not limited to flammable or explosive items, hazardous chemicals, improperly packed lithium batteries, weapons and replicas, drugs, cash and securities, and live animals or plants.
2.3 You are responsible for all costs from inaccurate declarations, prohibited items or improper packing, including holds, returns, disposal, fines and other charges, and for any losses caused to the carrier or to us.

3. Weight, dimensions and adjustments
3.1 Postage is calculated from the weight and dimensions you enter when ordering.
3.2 Carriers re-measure packages and bill the greater of actual and dimensional weight. If their measurement or zone differs from your order, we will charge (or refund) the difference based on the carrier's bill, using your account's pricing.
3.3 Every adjustment is itemized under "Adjustments" in your account and charged to or refunded from your balance.

4. Addresses
4.1 Make sure addresses are complete and accurate, including apartment/unit numbers. Our address check is for reference only.
4.2 Reroute and return costs caused by wrong or incomplete addresses are your responsibility.

5. Cancellations and refunds
5.1 You can request cancellation within {cancelHours} hours of ordering. Orders without a label are fully refunded; labels already issued incur a cancellation fee.
5.2 Labels past the cancellation window, used, or scanned by the carrier cannot be cancelled or refunded.

6. Delivery times and claims
6.1 Delivery times shown are carrier estimates, not guarantees. We are not responsible for delays caused by carriers, weather, holidays and similar events.
6.2 Lost or damaged packages are handled under the carrier's claims rules; we will help you file a claim. Unless extra insurance is purchased, compensation is limited to what the carrier pays.

7. Other
7.1 Rates and available services may change with carrier pricing; the price shown when you order applies.
7.2 Recipient information is used only for creating labels and delivery.
7.3 If these terms change materially, you will be asked to accept them again when you sign in.

If you have any questions, please contact support.`;

export interface Terms {
  zh: string;
  en: string;
  version: number;
  updatedAt: string | null;
}

export function getTerms(): Terms {
  const t = getSettings().terms;
  return { zh: t?.zh?.trim() || DEFAULT_TERMS_ZH, en: t?.en?.trim() || DEFAULT_TERMS_EN, version: t?.version || 1, updatedAt: t?.updatedAt ?? null };
}

/** 签署时记下的客户信息 */
export interface TermsParty {
  customer: string;
  address: string | null;
  contact: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
}

export function partyOf(c: Customer): TermsParty {
  return { customer: c.name, address: c.address, contact: c.contact, title: c.contactTitle, phone: c.phone, email: c.portalEmail ?? c.email };
}

/** 把 {brand}、{cancelHours}、{customer} 等换成当前设置和客户信息 */
export function renderTerms(text: string, party?: TermsParty) {
  const s = getSettings();
  return text
    .replace(/\{brand\}/g, s.brandName)
    .replace(/\{cancelHours\}/g, String(s.cancelWindowHours ?? 48))
    .replace(/\{customer\}/g, party?.customer ?? "")
    .replace(/\{address\}/g, party?.address ?? "")
    .replace(/\{contact\}/g, party?.contact ?? "")
    .replace(/\{title\}/g, party?.title ?? "");
}

/** 后台保存条款；bump = 要求所有客户重新同意（版本号 +1） */
export function saveTerms(zh: string, en: string, bump: boolean) {
  const cur = getTerms();
  saveSettings({
    terms: {
      zh: zh.trim() === DEFAULT_TERMS_ZH.trim() ? "" : zh.trim(),
      en: en.trim() === DEFAULT_TERMS_EN.trim() ? "" : en.trim(),
      version: bump ? cur.version + 1 : cur.version,
      updatedAt: new Date().toISOString(),
    },
  });
}

let ready = false;
function conn() {
  const c = db();
  if (!ready) {
    c.exec(`CREATE TABLE IF NOT EXISTS terms_acceptances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      signer TEXT,
      signer_title TEXT,
      party_json TEXT,
      lang TEXT,
      text TEXT,
      ip TEXT,
      user_agent TEXT,
      accepted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS terms_acc_customer ON terms_acceptances (customer_id, version);`);
    ready = true;
  }
  return c;
}

/** 客户同意条款：记下签署人、签署时的客户信息和当时看到的条款原文（存档） */
export function acceptTerms(input: { customerId: number; party: TermsParty; signer: string; signerTitle: string; lang: string; ip: string | null; userAgent: string | null }) {
  if (hasAcceptedTerms(input.customerId)) return;
  const t = getTerms();
  const text = renderTerms(input.lang === "en" ? t.en : t.zh, input.party);
  conn()
    .prepare("INSERT INTO terms_acceptances (customer_id, version, signer, signer_title, party_json, lang, text, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(input.customerId, t.version, input.signer.slice(0, 60), input.signerTitle.slice(0, 60), JSON.stringify(input.party), input.lang, text, input.ip?.slice(0, 80) ?? null, input.userAgent?.slice(0, 300) ?? null);
}

export function hasAcceptedTerms(customerId: number): boolean {
  return !!conn().prepare("SELECT 1 FROM terms_acceptances WHERE customer_id = ? AND version = ?").get(customerId, getTerms().version);
}

export interface TermsAcceptance {
  id: number;
  version: number;
  signer: string | null;
  signerTitle: string | null;
  party: TermsParty | null;
  lang: string | null;
  text: string | null;
  ip: string | null;
  acceptedAt: string;
}

/** 这个客户最近一次同意的记录（含签署时的条款原文） */
export function lastAcceptance(customerId: number): TermsAcceptance | null {
  const r = conn().prepare("SELECT * FROM terms_acceptances WHERE customer_id = ? ORDER BY id DESC LIMIT 1").get(customerId) as
    | { id: number; version: number; signer: string | null; signer_title: string | null; party_json: string | null; lang: string | null; text: string | null; ip: string | null; accepted_at: string }
    | undefined;
  return r
    ? { id: r.id, version: r.version, signer: r.signer, signerTitle: r.signer_title, party: r.party_json ? JSON.parse(r.party_json) : null, lang: r.lang, text: r.text, ip: r.ip, acceptedAt: r.accepted_at }
    : null;
}

/** 已同意当前版本的客户数 */
export function acceptedCount(): number {
  return (conn().prepare("SELECT COUNT(DISTINCT customer_id) AS n FROM terms_acceptances WHERE version = ?").get(getTerms().version) as { n: number }).n;
}
