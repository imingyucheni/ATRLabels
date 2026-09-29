/**
 * 客户服务条款：客户第一次登录（以及条款有重要修改、版本号变了之后）必须勾选同意才能使用客户中心。
 * 每次同意都记下版本、时间、IP，后台客户详情里可以查。
 */
import { db, getSettings, saveSettings, type Customer } from "./db";
import { createHash } from "node:crypto";
import { localDate } from "./reports";
import { fmtTime, TZ_LABEL } from "./time";

export const DEFAULT_TERMS_ZH = `{brand} 物流服务协议

甲方（服务方）：{company}
地址：{companyAddress}
联系邮箱：{companyEmail}

乙方（客户）：{customer}
地址：{address}
联系人：{contactLine}
电话：{phone}
邮箱：{email}

鉴于甲方运营 {brand} 物流面单服务平台，乙方希望通过该平台购买承运商面单及相关物流服务。双方经友好协商，就乙方使用甲方服务的相关事宜达成如下协议，共同遵守。

第一条　账户使用
1.1 甲方为乙方开设 {brand} 客户账户，该账户仅限乙方及其员工使用。乙方应妥善保管登录密码，通过乙方账户提交的订单均视为乙方的行为。
1.2 账户按单扣费：预付账户从余额中扣除，月结账户在甲方给予的信用额度内记账并按约定结算；可用余额（含信用额度）不足时不能下单。乙方的充值或付款在甲方确认到账后入账。

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

第八条　甲方的权利
8.1 乙方存在以下情形之一的，甲方有权不经事先通知暂停或终止乙方账户、拒绝或取消相关订单：申报不实、寄送违禁品、拖欠费用、恶意取消或滥用服务、违反承运商规定或法律法规，以及其他可能给甲方或承运商造成损失或风险的行为。
8.2 甲方有权根据承运商政策、成本变化和运营需要，调整服务价格、可用渠道、取消规则和其他服务内容，调整后的内容自页面公布或通知之日起适用于新订单。
8.3 订单、扣费、补差、余额等数据以甲方系统记录为准。乙方对账单有异议的，应在费用产生之日起 30 日内书面提出，逾期视为确认。
8.4 乙方账户余额为负数或有未结清费用的，乙方应在甲方通知后 7 日内付清；甲方有权从乙方后续充值中直接扣除。

第九条　责任限制
9.1 甲方提供的是承运商面单代购及相关技术服务，包裹的揽收、运输和派送由承运商负责。承运商的延误、丢失、损坏、错派、拒收、退件、系统故障等，甲方不承担责任，但会协助乙方向承运商交涉。
9.2 在法律允许的最大范围内，甲方就任何一张订单承担的全部责任，以乙方为该订单实际支付给甲方的运费为上限。
9.3 甲方不承担任何间接损失，包括但不限于利润损失、商誉损失、平台罚款、店铺评分下降、客户流失等。
9.4 因不可抗力（包括自然灾害、疫情、罢工、政府行为、战争、网络或电力中断、承运商或第三方系统故障等）导致服务中断或延误的，甲方不承担责任。

第十条　乙方的保证与赔偿
10.1 乙方保证其提供的信息真实、准确，寄送的货物合法，并有权使用其提供的收件人信息。
10.2 因乙方违反本协议、违反法律法规或承运商规定，导致甲方被第三方（包括承运商、政府部门、收件人）索赔、罚款或产生其他损失的，乙方应赔偿甲方由此产生的全部损失和合理费用（包括律师费）。

第十一条　协议的生效、变更与解释
11.1 本协议以电子方式签署：乙方授权签署人填写姓名、职位并勾选同意，即视为乙方签署本协议，与书面签字具有同等效力。签署时间、签署人及协议原文由系统存档。
11.2 本协议自乙方签署之日起生效，在乙方使用甲方服务期间持续有效。
11.3 甲方对本协议作重要修改时，将在乙方登录时提示，乙方重新签署后继续使用；乙方不同意修改的，可停止使用服务，并申请退还账户剩余余额（扣除未结清费用后）。
11.4 在法律允许的范围内，本协议及甲方平台上公布的各项服务规则的解释权归甲方所有。
11.5 本协议适用美国加利福尼亚州法律。因本协议产生的争议，双方应首先友好协商；协商不成的，提交加利福尼亚州洛杉矶县有管辖权的法院解决。
11.6 本协议任何条款被认定为无效或不可执行的，不影响其他条款的效力。
11.7 本协议中文版与英文版具有同等效力；两者不一致时，以英文版为准。

（以下为签署栏）

甲方（服务方）：{company}
联系邮箱：{companyEmail}

乙方（客户）：{customer}
联系人：{contactLine}
联系电话：{phone}
联系邮箱：{email}
授权签署人：{signer}
职位：{signerTitle}
签署日期：{signDate}`;

export const DEFAULT_TERMS_EN = `{brand} Shipping Services Agreement

Party A (Provider): {company}
Address: {companyAddress}
Email: {companyEmail}

Party B (Customer): {customer}
Address: {address}
Contact: {contactLine}
Phone: {phone}
Email: {email}

Whereas Party A operates the {brand} shipping label platform and Party B wishes to purchase carrier labels and related shipping services through it, the parties agree as follows.

Article 1. Account
1.1 Party A opens a {brand} customer account for Party B, for use by Party B and its staff only. Party B shall keep its password safe; orders placed through Party B's account are treated as placed by Party B.
1.2 Labels are charged per order: prepaid accounts are charged from their balance, and monthly accounts are billed within the credit limit granted by Party A and settled as agreed. Orders cannot be placed when the available balance (including any credit limit) is insufficient. Top-ups and payments are credited once Party A confirms receipt.

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

Article 8. Party A's rights
8.1 Party A may, without prior notice, suspend or terminate Party B's account and refuse or cancel related orders if Party B makes inaccurate declarations, ships prohibited items, fails to pay amounts due, cancels maliciously or abuses the service, violates carrier rules or applicable law, or engages in any other conduct that may cause loss or risk to Party A or the carriers.
8.2 Party A may adjust prices, available services, cancellation rules and other service terms based on carrier policies, cost changes and operational needs. Changes apply to new orders from the date they are published on the platform or notified.
8.3 Party A's system records are the basis for orders, charges, adjustments and balances. Any dispute over charges must be raised in writing within 30 days of the charge; otherwise the charge is deemed accepted.
8.4 If Party B's balance is negative or has unpaid amounts, Party B shall pay within 7 days of Party A's notice, and Party A may deduct such amounts from Party B's subsequent top-ups.

Article 9. Limitation of liability
9.1 Party A provides carrier label purchasing and related technology services; pickup, transport and delivery are performed by the carriers. Party A is not liable for carrier delays, loss, damage, misdelivery, refusal, returns or system failures, but will assist Party B in dealing with the carrier.
9.2 To the maximum extent permitted by law, Party A's total liability for any single order is limited to the postage Party B actually paid to Party A for that order.
9.3 Party A is not liable for any indirect or consequential losses, including lost profits, loss of goodwill, marketplace penalties, seller rating drops or loss of customers.
9.4 Party A is not liable for service interruption or delay caused by force majeure, including natural disasters, epidemics, strikes, government actions, war, network or power outages, and failures of carrier or third-party systems.

Article 10. Party B's warranties and indemnity
10.1 Party B warrants that the information it provides is true and accurate, that the goods it ships are lawful, and that it has the right to use the recipient information it provides.
10.2 Party B shall indemnify Party A for all losses and reasonable expenses (including attorneys' fees) arising from any claim, fine or loss imposed on Party A by third parties (including carriers, government authorities and recipients) as a result of Party B's breach of this Agreement, applicable law or carrier rules.

Article 11. Effect, amendments and interpretation
11.1 This Agreement is signed electronically: Party B's authorized signer entering their name and title and checking the acceptance box constitutes Party B's signature, with the same effect as a handwritten signature. The signing time, signer and the exact text are archived by the system.
11.2 This Agreement takes effect on the date Party B signs it and remains in effect while Party B uses Party A's services.
11.3 If Party A materially amends this Agreement, Party B will be asked to sign again when signing in; if Party B does not agree, it may stop using the services and request a refund of its remaining balance (after deducting any unpaid amounts).
11.4 To the extent permitted by law, Party A reserves the right to interpret this Agreement and the service rules published on its platform.
11.5 This Agreement is governed by the laws of the State of California, USA. The parties shall first seek to resolve any dispute through friendly negotiation; failing that, the dispute shall be submitted to a court of competent jurisdiction in Los Angeles County, California.
11.6 If any provision of this Agreement is held invalid or unenforceable, the remaining provisions remain in effect.
11.7 The Chinese and English versions of this Agreement have equal effect; in case of any inconsistency, the English version prevails.

(Signatures)

Party A (Provider): {company}
Email: {companyEmail}

Party B (Customer): {customer}
Contact: {contactLine}
Phone: {phone}
Email: {email}
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

/** 统一换行：浏览器文本框提交的是 \r\n，和系统默认文本比较前要先统一 */
const normText = (t: string | null | undefined) => (t ?? "").replace(/\r\n?/g, "\n").trim();

/**
 * 以前各个版本的系统默认条款（原文的 SHA-256 前 16 位）。
 * 以前在后台点“保存”时，因为换行符不同，没改过的默认条款也被存成了“自定义”，之后系统默认条款更新了也显示不出来；
 * 存的内容如果就是以前的某个默认版本，当作没有自定义，直接用最新的默认条款。
 */
const OLD_DEFAULTS = new Set([
  "92d896d6aa6db8cb", "7a6fbbec4b8afff1", "bd748ddb61a4fb04", "b47db10231f69605", "c64e45f90b51c0e8", "8de42b865874515a",
  "738161870b666681", "287e4933fff31a4d", "4dcf5e17ea09e9ca", "4094eef49137b52f", "07e65995ce644b28", "62684574de183fbf",
]);
const isOldDefault = (t: string) => OLD_DEFAULTS.has(createHash("sha256").update(t, "utf8").digest("hex").slice(0, 16));

/** 后台存的自定义条款；空的、或者其实是某个版本的默认条款，都返回 null（用系统默认） */
function customText(saved: string | null | undefined, def: string): string | null {
  const t = normText(saved);
  if (!t || t === normText(def) || isOldDefault(t)) return null;
  return t;
}

export function getTerms(): Terms {
  const t = getSettings().terms;
  return {
    zh: customText(t?.zh, DEFAULT_TERMS_ZH) ?? DEFAULT_TERMS_ZH,
    en: customText(t?.en, DEFAULT_TERMS_EN) ?? DEFAULT_TERMS_EN,
    version: t?.version || 1,
    updatedAt: t?.updatedAt ?? null,
    changeNote: t?.changeNote ?? "",
  };
}

/** 后台现在用的是不是系统默认条款 */
export function usingDefaultTerms() {
  const t = getSettings().terms;
  return !customText(t?.zh, DEFAULT_TERMS_ZH) && !customText(t?.en, DEFAULT_TERMS_EN);
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
  return { company: s.site?.company?.trim() || s.brandName, address: s.site?.contractAddress?.trim() || s.site?.address?.trim() || "", email: s.site?.contractEmail?.trim() || s.site?.email?.trim() || "", brand: s.brandName };
}

/** 把 {company}、{brand}、{cancelHours}、{customer} 等换成当前设置和客户信息 */
/** sign = 签署栏（签署时填入）；没签时留空白横线 */
export function renderTerms(text: string, party?: TermsParty, sign?: { signer: string; title: string; date: string }) {
  const s = getSettings();
  return text
    .replace(/\{company\}/g, provider().company)
    .replace(/\{companyAddress\}/g, provider().address || "—")
    .replace(/\{companyEmail\}/g, provider().email || "—")
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
      zh: customText(zh, DEFAULT_TERMS_ZH) ?? "",
      en: customText(en, DEFAULT_TERMS_EN) ?? "",
      version: bump ? cur.version + 1 : cur.version,
      updatedAt: new Date().toISOString(),
      changeNote: bump ? changeNote.trim().slice(0, 500) : cur.changeNote,
    },
  });
}

// 按数据库连接记：切换正式 / 测试环境、恢复备份后换了数据库文件，要重新建表
let ready: unknown = null;
function conn() {
  const c = db();
  if (ready !== c) {
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
    // 签署时条款原文的 SHA-256：以后可以核对存档没有被改过
    const cols = (c.prepare("PRAGMA table_info(terms_acceptances)").all() as { name: string }[]).map((x) => x.name);
    if (!cols.includes("text_sha256")) c.exec("ALTER TABLE terms_acceptances ADD COLUMN text_sha256 TEXT");
    ready = c;
  }
  return c;
}

/** 客户同意条款：记下签署人、签署时的客户信息和当时看到的条款原文（存档） */
export function acceptTerms(input: { customerId: number; party: TermsParty; signer: string; signerTitle: string; lang: string; ip: string | null; userAgent: string | null }) {
  if (hasAcceptedTerms(input.customerId)) return;
  const t = getTerms();
  const text = renderTerms(input.lang === "en" ? t.en : t.zh, input.party, { signer: input.signer.slice(0, 60), title: input.signerTitle.slice(0, 60), date: localDate() });
  conn()
    .prepare("INSERT INTO terms_acceptances (customer_id, version, signer, signer_title, party_json, lang, text, text_sha256, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(input.customerId, t.version, input.signer.slice(0, 60), input.signerTitle.slice(0, 60), JSON.stringify(input.party), input.lang, text, sha256(text), input.ip?.slice(0, 80) ?? null, input.userAgent?.slice(0, 300) ?? null);
}

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

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
  userAgent: string | null;
  /** 签署时存下的原文校验码（旧记录没有） */
  sha256: string | null;
  customerId: number;
  acceptedAt: string;
}

type AcceptRow = { id: number; version: number; signer: string | null; signer_title: string | null; party_json: string | null; lang: string | null; text: string | null; ip: string | null; user_agent: string | null; text_sha256: string | null; customer_id: number; accepted_at: string };
const toAcceptance = (r: AcceptRow): TermsAcceptance => ({
  id: r.id, version: r.version, signer: r.signer, signerTitle: r.signer_title, party: r.party_json ? JSON.parse(r.party_json) : null, lang: r.lang, text: r.text, ip: r.ip, userAgent: r.user_agent, sha256: r.text_sha256, customerId: r.customer_id, acceptedAt: r.accepted_at,
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

export function acceptanceById(id: number): TermsAcceptance | null {
  const r = conn().prepare("SELECT * FROM terms_acceptances WHERE id = ?").get(id) as AcceptRow | undefined;
  return r ? toAcceptance(r) : null;
}

/** 全部签署记录（导出存档用，按签署时间） */
export function allAcceptances(): TermsAcceptance[] {
  return (conn().prepare("SELECT * FROM terms_acceptances ORDER BY id").all() as AcceptRow[]).map(toAcceptance);
}

/** 存档原文是否和签署时一致 */
export const archiveIntact = (a: TermsAcceptance) => (a.sha256 && a.text != null ? sha256(a.text) === a.sha256 : null);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 一份签署存档的独立文件（HTML，浏览器打开可打印 / 另存 PDF）：签署记录 + 协议原文 */
export function acceptanceDocument(a: TermsAcceptance): string {
  const en = a.lang === "en";
  const rows: [string, string][] = en
    ? [["Customer", a.party?.customer ?? ""], ["Signer", [a.signer, a.signerTitle].filter(Boolean).join(" · ")], ["Signed at", `${fmtTime(a.acceptedAt)} (${TZ_LABEL === "美西时间" ? "US Pacific" : TZ_LABEL})`], ["Version", String(a.version)], ["IP", a.ip ?? "—"], ["Browser", a.userAgent ?? "—"], ["SHA-256 of text", a.sha256 ?? "—"]]
    : [["客户", a.party?.customer ?? ""], ["签署人", [a.signer, a.signerTitle].filter(Boolean).join(" · ")], ["签署时间", `${fmtTime(a.acceptedAt)}（${TZ_LABEL}）`], ["协议版本", `第 ${a.version} 版`], ["签署 IP", a.ip ?? "—"], ["浏览器", a.userAgent ?? "—"], ["原文校验码 SHA-256", a.sha256 ?? "—"]];
  const title = `${en ? "Signed agreement" : "签署存档"} · ${a.party?.customer ?? ""} · ${a.acceptedAt.slice(0, 10)}`;
  return `<!doctype html><html lang="${en ? "en" : "zh"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1a1a1a;background:#fff;max-width:820px;margin:0 auto;padding:32px 20px;line-height:1.75}table{border-collapse:collapse;width:100%;font-size:13px;margin-bottom:24px}td{border:1px solid #ddd;padding:6px 10px;vertical-align:top;word-break:break-all}td:first-child{width:160px;color:#555;background:#f7f7f7}pre{white-space:pre-wrap;font-family:inherit;font-size:15px;margin:0}h1{font-size:16px;color:#555;font-weight:500}</style></head><body>
<h1>${esc(en ? "Electronic signing record" : "电子签署记录")}</h1><table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
<pre>${esc(a.text ?? "")}</pre></body></html>`;
}

/** 存档文件名：客户名-第N版-日期.html */
export const acceptanceFilename = (a: TermsAcceptance) =>
  `${(a.party?.customer ?? `customer-${a.customerId}`).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60)}-v${a.version}-${a.acceptedAt.slice(0, 10)}-${a.id}.html`;

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

