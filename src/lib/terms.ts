/**
 * 客户服务条款：客户第一次登录（以及条款有重要修改、版本号变了之后）必须勾选同意才能使用客户中心。
 * 每次同意都记下版本、时间、IP，后台客户详情里可以查。
 */
import { db, getSettings, saveSettings, type Customer } from "./db";
import { localDate } from "./reports";

export const DEFAULT_TERMS_ZH = `{brand} 物流服务协议

甲方（服务方）：{company}
地址：{companyAddress}

乙方（客户）：{customer}
地址：{address}
联系人：{contactLine}
电话：{phone}
邮箱：{email}

鉴于甲方运营 {brand} 物流面单服务平台，乙方希望通过该平台购买承运商面单及相关物流服务。双方经友好协商，就乙方使用甲方服务的相关事宜达成如下协议，共同遵守。

第一条　账户使用
1.1 甲方为乙方开设 {brand} 客户账户，该账户仅限乙方及其员工使用。乙方应妥善保管登录密码，通过乙方账户提交的订单均视为乙方的行为。
1.2 账户采用预付余额、按单扣费的方式；余额不足时不能下单。乙方的充值在甲方确认到账后入账。

第二条　如实申报货物
2.1 乙方应如实、准确填写收件人信息、包裹重量、尺寸、品名、数量和申报价值。
2.2 乙方不得寄送违禁品及承运商禁运物品，包括但不限于：易燃易爆品、危险化学品、未按规定包装的锂电池、武器及仿真武器、毒品、现金及有价证券、活体动植物等。
2.3 因申报不实、违禁品或包装不当造成的扣件、退件、销毁、罚款及其他费用，由乙方承担；造成承运商或甲方损失的，乙方应承担赔偿责任。

第三条　重量、尺寸与补差
3.1 运费按乙方下单时填写的重量和尺寸计算。
3.2 承运商会复核包裹的实际重量和体积重量（以两者较大者计费）。复核结果与填写不一致、或分区有差异时，甲方按承运商账单向乙方补收（或退还）差价，按乙方账户的价格规则计算。
3.3 每一笔补差都会在乙方账户的“补差明细”中逐单列明，并从账户余额中扣除或退回。

第四条　收件地址
4.1 乙方应确保收件地址完整、准确（包括公寓号 / 单元号）。系统的地址核对仅供参考。
4.2 因地址错误或不完整产生的改派、退件等费用由乙方承担。

第五条　取消与退款
5.1 乙方可在下单后 {cancelHours} 小时内申请取消：未出面单的全额退回余额；已出面单的按规定收取取消手续费。
5.2 超过取消时限、已经使用或已被承运商扫描的面单不能取消退款。

第六条　时效与理赔
6.1 页面显示的派送时效为承运商的参考时效，甲方不作保证；承运商延误、天气、节假日等原因造成的延迟不属于甲方责任。
6.2 包裹丢失或损坏的，按承运商的理赔规定处理，甲方协助乙方向承运商申请理赔；除乙方另行购买保险外，赔偿以承运商实际赔付为准。

第七条　价格与信息保护
7.1 运费价格和可用渠道可能随承运商调整而变化，以乙方下单时页面显示的价格为准。
7.2 乙方提供的收件人信息仅用于出单和派送，甲方不会用于其他用途。

第八条　协议的生效与变更
8.1 本协议以电子方式签署：乙方授权签署人填写姓名、职位并勾选同意，即视为乙方签署本协议，与书面签字具有同等效力。签署时间、签署人及协议原文由系统存档。
8.2 本协议自乙方签署之日起生效，在乙方使用甲方服务期间持续有效。
8.3 甲方对本协议作重要修改时，将在乙方登录时提示，乙方重新签署后继续使用；乙方不同意修改的，可停止使用服务，并申请退还账户剩余余额。
8.4 因本协议产生的任何争议，双方应首先友好协商解决。

（以下为签署栏）

甲方（服务方）：{company}

乙方（客户）：{customer}
授权签署人：{signer}
职位：{signerTitle}
签署日期：{signDate}`;

export const DEFAULT_TERMS_EN = `{brand} Shipping Services Agreement

Party A (Provider): {company}
Address: {companyAddress}

Party B (Customer): {customer}
Address: {address}
Contact: {contactLine}
Phone: {phone}
Email: {email}

Whereas Party A operates the {brand} shipping label platform and Party B wishes to purchase carrier labels and related shipping services through it, the parties agree as follows.

Article 1. Account
1.1 Party A opens a {brand} customer account for Party B, for use by Party B and its staff only. Party B shall keep its password safe; orders placed through Party B's account are treated as placed by Party B.
1.2 The account is prepaid and charged per label. Orders cannot be placed when the balance is insufficient. Top-ups are credited once Party A confirms receipt.

Article 2. Accurate declarations
2.1 Party B shall provide accurate recipient details, package weight, dimensions, item descriptions, quantities and declared values.
2.2 Party B shall not ship prohibited or carrier-restricted items, including but not limited to flammable or explosive items, hazardous chemicals, improperly packed lithium batteries, weapons and replicas, drugs, cash and securities, and live animals or plants.
2.3 Party B is responsible for all costs arising from inaccurate declarations, prohibited items or improper packing, including holds, returns, disposal, fines and other charges, and for any losses caused to the carrier or to Party A.

Article 3. Weight, dimensions and adjustments
3.1 Postage is calculated from the weight and dimensions Party B enters when ordering.
3.2 Carriers re-measure packages and bill the greater of actual and dimensional weight. If their measurement or zone differs from the order, Party A will charge (or refund) the difference based on the carrier's bill, using Party B's account pricing.
3.3 Every adjustment is itemized under "Adjustments" in Party B's account and charged to or refunded from the balance.

Article 4. Addresses
4.1 Party B shall make sure addresses are complete and accurate, including apartment/unit numbers. The system's address check is for reference only.
4.2 Reroute and return costs caused by wrong or incomplete addresses are borne by Party B.

Article 5. Cancellations and refunds
5.1 Party B may request cancellation within {cancelHours} hours of ordering. Orders without a label are fully refunded; labels already issued incur a cancellation fee.
5.2 Labels past the cancellation window, used, or scanned by the carrier cannot be cancelled or refunded.

Article 6. Delivery times and claims
6.1 Delivery times shown are carrier estimates and are not guaranteed by Party A. Party A is not responsible for delays caused by carriers, weather, holidays and similar events.
6.2 Lost or damaged packages are handled under the carrier's claims rules, and Party A will help Party B file a claim. Unless Party B purchases extra insurance, compensation is limited to what the carrier pays.

Article 7. Pricing and data protection
7.1 Rates and available services may change with carrier pricing; the price shown when Party B places an order applies.
7.2 Recipient information provided by Party B is used only for creating labels and delivery.

Article 8. Effect and amendments
8.1 This Agreement is signed electronically: Party B's authorized signer entering their name and title and checking the acceptance box constitutes Party B's signature, with the same effect as a handwritten signature. The signing time, signer and the exact text are archived by the system.
8.2 This Agreement takes effect on the date Party B signs it and remains in effect while Party B uses Party A's services.
8.3 If Party A materially amends this Agreement, Party B will be asked to sign again when signing in; if Party B does not agree, it may stop using the services and request a refund of its remaining balance.
8.4 The parties shall first seek to resolve any dispute arising from this Agreement through friendly negotiation.

(Signatures)

Party A (Provider): {company}

Party B (Customer): {customer}
Authorized signer: {signer}
Title: {signerTitle}
Date signed: {signDate}`;

export interface Terms {
  zh: string;
  en: string;
  version: number;
  updatedAt: string | null;
  /** 这一版改了什么（重新签署时显示给客户，也写进通知邮件） */
  changeNote: string;
}

export function getTerms(): Terms {
  const t = getSettings().terms;
  return { zh: t?.zh?.trim() || DEFAULT_TERMS_ZH, en: t?.en?.trim() || DEFAULT_TERMS_EN, version: t?.version || 1, updatedAt: t?.updatedAt ?? null, changeNote: t?.changeNote ?? "" };
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

/** 服务方（我们公司）：法人名称和地址，来自“设置 → 官网与联系方式” */
export function provider() {
  const s = getSettings();
  return { company: s.site?.company?.trim() || s.brandName, address: s.site?.contractAddress?.trim() || s.site?.address?.trim() || "", brand: s.brandName };
}

/** 把 {company}、{brand}、{cancelHours}、{customer} 等换成当前设置和客户信息 */
/** sign = 签署栏（签署时填入）；没签时留空白横线 */
export function renderTerms(text: string, party?: TermsParty, sign?: { signer: string; title: string; date: string }) {
  const s = getSettings();
  return text
    .replace(/\{company\}/g, provider().company)
    .replace(/\{companyAddress\}/g, provider().address || "—")
    .replace(/\{brand\}/g, s.brandName)
    .replace(/\{cancelHours\}/g, String(s.cancelWindowHours ?? 48))
    .replace(/\{customer\}/g, party?.customer ?? "")
    .replace(/\{address\}/g, party?.address || "—")
    .replace(/\{contactLine\}/g, [party?.contact, party?.title].filter(Boolean).join(" · ") || "—")
    .replace(/\{phone\}/g, party?.phone || "—")
    .replace(/\{email\}/g, party?.email || "—")
    .replace(/\{contact\}/g, party?.contact ?? "")
    .replace(/\{title\}/g, party?.title ?? "")
    .replace(/\{signer\}/g, sign?.signer || "________________")
    .replace(/\{signerTitle\}/g, sign?.title || "________________")
    .replace(/\{signDate\}/g, sign?.date || "________________");
}

/** 后台保存条款；bump = 要求所有客户重新同意（版本号 +1），changeNote = 这次改了什么 */
export function saveTerms(zh: string, en: string, bump: boolean, changeNote = "") {
  const cur = getTerms();
  saveSettings({
    terms: {
      zh: zh.trim() === DEFAULT_TERMS_ZH.trim() ? "" : zh.trim(),
      en: en.trim() === DEFAULT_TERMS_EN.trim() ? "" : en.trim(),
      version: bump ? cur.version + 1 : cur.version,
      updatedAt: new Date().toISOString(),
      changeNote: bump ? changeNote.trim().slice(0, 500) : cur.changeNote,
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
  const text = renderTerms(input.lang === "en" ? t.en : t.zh, input.party, { signer: input.signer.slice(0, 60), title: input.signerTitle.slice(0, 60), date: localDate() });
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

type AcceptRow = { id: number; version: number; signer: string | null; signer_title: string | null; party_json: string | null; lang: string | null; text: string | null; ip: string | null; accepted_at: string };
const toAcceptance = (r: AcceptRow): TermsAcceptance => ({
  id: r.id, version: r.version, signer: r.signer, signerTitle: r.signer_title, party: r.party_json ? JSON.parse(r.party_json) : null, lang: r.lang, text: r.text, ip: r.ip, acceptedAt: r.accepted_at,
});

/** 这个客户最近一次同意的记录（含签署时的条款原文） */
export function lastAcceptance(customerId: number): TermsAcceptance | null {
  const r = conn().prepare("SELECT * FROM terms_acceptances WHERE customer_id = ? ORDER BY id DESC LIMIT 1").get(customerId) as AcceptRow | undefined;
  return r ? toAcceptance(r) : null;
}

/** 这个客户签过的所有版本（新的在前） */
export function listAcceptances(customerId: number): TermsAcceptance[] {
  return (conn().prepare("SELECT * FROM terms_acceptances WHERE customer_id = ? ORDER BY id DESC").all(customerId) as AcceptRow[]).map(toAcceptance);
}

export function getAcceptance(customerId: number, id: number): TermsAcceptance | null {
  const r = conn().prepare("SELECT * FROM terms_acceptances WHERE customer_id = ? AND id = ?").get(customerId, id) as AcceptRow | undefined;
  return r ? toAcceptance(r) : null;
}

/** 已开通客户端登录、还没签当前版本的客户 */
export function unsignedCustomers(): { id: number; name: string; email: string | null; signedVersion: number | null }[] {
  conn();
  return db()
    .prepare(
      `SELECT c.id, c.name, c.portal_email AS email,
        (SELECT MAX(version) FROM terms_acceptances a WHERE a.customer_id = c.id) AS signedVersion
       FROM customers c
       WHERE COALESCE(c.internal, 0) = 0 AND c.portal_enabled = 1
         AND NOT EXISTS (SELECT 1 FROM terms_acceptances a WHERE a.customer_id = c.id AND a.version = ?)
       ORDER BY c.name`,
    )
    .all(getTerms().version) as { id: number; name: string; email: string | null; signedVersion: number | null }[];
}

/** 已同意当前版本的客户数 */
export function acceptedCount(): number {
  return (conn().prepare("SELECT COUNT(DISTINCT customer_id) AS n FROM terms_acceptances WHERE version = ?").get(getTerms().version) as { n: number }).n;
}

