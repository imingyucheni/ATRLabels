import { fmtTime } from "@/lib/time";
import Link from "next/link";
import { headers } from "next/headers";
import { omsLoginUrl } from "@/lib/sites";
import { pendingCredentials } from "@/lib/credentials";
import CredentialsCard from "@/components/CredentialsCard";
import { notFound } from "next/navigation";
import { customerChannelCodes, customerChannels, getCustomer, getSettings, listChannels } from "@/lib/db";
import { customerChannelMarkups, describeRule, effectiveRule, listMarkupLog, MARKUP_SOURCE_LABEL } from "@/lib/markup";
import FlashForm from "@/components/FlashForm";
import { hasAcceptedTerms, lastAcceptance } from "@/lib/terms";
import RuleInputs from "@/components/RuleInputs";
import AddressFields from "@/components/AddressFields";
import { LEDGER_TYPE_LABEL, listLedger } from "@/lib/ledger";
import { computePrice, money, resolveRule, signedPercent } from "@/lib/pricing";
import { getT, getLang } from "@/lib/prefs";
import { translateMessage } from "@/lib/i18n";
import PinField from "@/components/PinField";
import StoresCard from "./StoresCard";
import ApiCard from "./ApiCard";
import SalesCard from "./SalesCard";
import { groupChannels } from "@/lib/channelGroups";
import StaffAccessCard from "./StaffAccessCard";
import { currentAdmin } from "@/lib/auth";
import { customerAccess } from "@/lib/adminSession";
import { actorLabel } from "@/lib/actor";
import { ledgerEntryAction, hideCredentialsAction, saveCustomerAction, saveCustomerChannelsAction, saveCustomerChannelMarkupAction, saveCustomerPortalAction, saveCustomerSenderAction, saveCustomerStampAction, setCustomerPasswordAction, setTestAccountAction } from "@/app/actions";

const TABS = [
  ["overview", "概况"],
  ["pricing", "渠道与价格"],
  ["profile", "资料与登录"],
  ["integrations", "店铺与 API"],
  ["advanced", "高级"],
] as const;
type Tab = (typeof TABS)[number][0];

export default async function CustomerEdit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const tabParam = (await searchParams).tab;
  // 员工（二级管理员）：只有概况（充值）、渠道与价格（设置邮费）、资料与登录（开户）三个页签
  const who = await currentAdmin();
  const staff = who?.role === "staff";
  const tabs = TABS.filter(([k]) => !staff || ["overview", "pricing", "profile"].includes(k));
  const tab: Tab = (tabs.find(([k]) => k === tabParam)?.[0] ?? "overview") as Tab;
  // 新客户只有资料表单；老客户按标签页分开显示，页面不再一长条
  const show = (k: Tab) => tab === k;
  const c = id === "new" ? null : getCustomer(Number(id));
  if (id !== "new" && !c) notFound();
  // 员工：没授权的客户 proxy 已经拦了；只读权限时页面上的表单全部禁用（服务端也会拒绝）
  const ro = !!c && staff && customerAccess(who, c.id) === "view";
  const { markup } = getSettings();
  const h = await headers();
  const creds = c ? pendingCredentials(c.id) : null;
  const omsLogin = omsLoginUrl(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`);
  const ledger = c ? listLedger({ customerId: c.id, limit: 100 }) : [];
  const allChannels = listChannels();
  const opened = new Set(c ? customerChannelCodes(c.id) : []);
  const g = getSettings().stamp;
  const t = await getT();
  const lang = await getLang();
  const note = (s: string | null) => (s ? s.split(" · ").map((x) => translateMessage(lang, x)).join(" · ") : s);
  const onChannels = allChannels.filter((ch) => (ch.stamp?.enabled ?? g.enabled)).map((ch) => ch.name.split(/[-（(]/)[0]);
  const stampSummary = onChannels.length ? t("当前加印：{list}", { list: onChannels.join(t("、")) }) : t("当前都不加印");
  const usable = allChannels.filter((ch) => ch.enabled && opened.has(ch.code)).length;
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{c ? t("编辑客户：{name}", { name: c.name }) : t("新增客户")}</h1>
        <div className="row">
          {/* 在当前标签页进入：OMS 里点“退出代操作”会直接回到后台，不会多出一个后台标签页 */}
          {c && !staff && <a className="btn primary" href={`/api/customers/${c.id}/oms`}>{t("进入客户 OMS")}</a>}
          <Link href="/customers">{t("← 返回")}</Link>
        </div>
      </div>
      {c && creds && !ro && (
        <CredentialsCard brand={getSettings().brandName} name={c.name} url={omsLogin} email={creds.email} password={creds.password}
          onHide={hideCredentialsAction.bind(null, c.id)} noChannels={!usable} />
      )}
      {c && (
        <nav className="tabs-bar" aria-label={t("客户详情")}>
          {tabs.map(([k, label]) => (
            <Link key={k} href={`/customers/${c.id}?tab=${k}`} className={tab === k ? "on" : ""} aria-current={tab === k ? "page" : undefined}>
              {t(label)}
              {k === "overview" && <span className={`tab-note${c.balance < 0 ? " neg" : ""}`}>{money(c.balance)}</span>}
              {k === "pricing" && <span className={`tab-note${usable ? "" : " neg"}`}>{usable ? t("{n} 个渠道", { n: usable }) : t("未开通")}</span>}
            </Link>
          ))}
        </nav>
      )}
      {ro && <div className="alert warn">{t("这个客户你只有查看权限，不能修改、设置邮费或充值。需要操作请找主管理员授权。")}</div>}
      <fieldset className="ro-wrap" disabled={ro}>
      {(!c || show("profile")) && <FlashForm action={saveCustomerAction} submitLabel={c ? "保存" : "创建客户并生成登录信息"} className="card" review={!!c}>
        <input type="hidden" name="id" value={c?.id ?? ""} />
        <div className="grid">
          <label className="f"><span className="req">{t("名称")}</span><input name="name" required defaultValue={c?.name} /></label>
          <label className="f"><span className="req">{t("联系人")}</span><input name="contact" required defaultValue={c?.contact ?? ""} /></label>
          <label className="f"><span className="req">{t("联系人职位")}</span><input name="contactTitle" required maxLength={60} defaultValue={c?.contactTitle ?? ""} placeholder={t("例如：总经理 / 物流主管")} /></label>
          <label className="f"><span className="req">{t("电话")}</span><input name="phone" required defaultValue={c?.phone ?? ""} /></label>
          <label className="f">{c ? t("邮箱") : <span className="req">{t("邮箱（客户 OMS 登录账号）")}</span>}<input name="email" type="email" required={!c} defaultValue={c?.email ?? ""} /></label>
          <label className="f" style={{ gridColumn: "1 / -1" }}><span className="req">{t("地址")}</span><input name="address" required maxLength={200} defaultValue={c?.address ?? ""} placeholder={t("公司地址，会显示在服务条款的客户信息里")} /></label>
        </div>
        <h3>{t("专属加价（留空 = 沿用渠道 / 全局设置）")}</h3>
        <div className="grid">
          <RuleInputs value={c?.markup} placeholder={{ percent: t("默认 {v}", { v: markup.percent }), fixed: t("默认 {v}", { v: markup.fixed }), minProfit: t("默认 {v}", { v: markup.minProfit }) }} />
        </div>
        <label className="f" style={{ margin: "12px 0" }}>{t("备注")}<textarea name="note" rows={2} defaultValue={c?.note ?? ""} /></label>
      </FlashForm>}
      {c && !c.internal && (show("profile") || show("overview")) && (() => {
        const signed = lastAcceptance(c.id);
        const current = hasAcceptedTerms(c.id);
        return (
          <div className={`alert ${current ? "ok" : "warn"}`}>
            <b>{t("服务条款")}</b>{t("：")}
            {signed
              ? <>{t("{who} 于 {time} 签署第 {v} 版", { who: [signed.signer, signed.signerTitle].filter(Boolean).join(" · "), time: fmtTime(signed.acceptedAt), v: signed.version })}{!current && ` · ${t("条款已更新，客户下次登录时需要重新签署")}`} · <Link href={`/customers/${c.id}/terms`}>{t("查看签署存档")}</Link></>
              : t("还没有签署，客户第一次登录客户中心时需要签署")}
          </div>
        );
      })()}
      {c && !c.internal && show("advanced") && (
        <FlashForm action={setTestAccountAction} submitLabel={c.testAccount ? "取消内部测试账号" : "设为内部测试账号"} submitClass="small" className={`alert ${c.testAccount ? "warn" : ""}`}>
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="on" value={c.testAccount ? "0" : "1"} />
          <div style={{ marginBottom: 8 }}>
            <b>{t("内部测试账号")}</b>{t("：")}
            {c.testAccount
              ? t("是。这个账号下的单都是模拟面单：报价是真实的，但不向服务商下单、不产生费用，不计入营收和对账，可以在“设置 → 清除测试数据”里一键清掉。")
              : t("否。自己人测试用的账号可以设为内部测试账号：下单变成模拟面单，不花钱、不计入营收，测完可以一键清除。")}
          </div>
        </FlashForm>
      )}
      {c && (
        <>
          {show("overview") && <div className="stats">
            <div className="stat"><div className="muted">{t("账户余额")}</div><div className={`v ${c.balance < 0 ? "profit-neg" : ""}`}>{money(c.balance)}</div></div>
            <div className="stat"><div className="muted">{t("信用额度")}</div><div className="v">{money(c.creditLimit)}</div></div>
            <div className="stat"><div className="muted">{t("可用额度")}</div><div className="v">{money(c.balance + c.creditLimit)}</div></div>
            <div className="stat"><div className="muted">{t("客户端登录")}</div><div className="v" style={{ fontSize: 16 }}>{c.portalEnabled ? (c.hasPassword ? t("已开通") : t("未设密码")) : t("未开通")}</div></div>
          </div>}

          {show("pricing") && <FlashForm action={saveCustomerChannelsAction} submitLabel="保存渠道" className="card" id="channels" review>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>{t("可用渠道")}</h2>
              <span className={`badge ${usable ? "ok" : "warn"}`}>{usable ? t("已开通 {n} 个", { n: usable }) : t("未开通，客户无法下单")}</span>
            </div>
            <p className="small muted">{t("新客户默认不开通任何渠道。勾选后客户才能用这些渠道查询运费、下单和批量导入；后台代下单也只能用这里开通的渠道。")}</p>
            <input type="hidden" name="id" value={c.id} />
            {/* 按服务商分组 */}
            {groupChannels(allChannels).map((g) => (
              <div key={g.provider} className="ch-check-group">
                <div className="ch-check-head"><b>{t(g.label)}</b><span className="small muted"> · {t("已开通 {a} / 共 {b} 个", { a: g.list.filter((ch) => opened.has(ch.code)).length, b: g.list.length })}</span></div>
                <div className="check-grid">
                  {g.list.map((ch) => (
                    <label key={ch.code} className={`check-tile ${ch.enabled ? "" : "disabled"}`}>
                      <input type="checkbox" name="channels" value={ch.code} defaultChecked={opened.has(ch.code)} />
                      <span>
                        <b>{ch.name}</b>
                        <span className="small muted">{ch.code}{ch.enabled ? "" : t(" · 设置里已停用，暂不可用")}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {!allChannels.length && <span className="small muted">{t("还没有渠道，请先到")} <Link href="/settings?tab=providers">{t("设置")}</Link> {t("同步渠道。")}</span>}
          </FlashForm>}

          {!c.internal && !staff && show("pricing") && <SalesCard customerId={c.id} />}

          {!c.internal && show("pricing") && (() => {
            const open = customerChannels(c.id);
            const own = customerChannelMarkups(c.id);
            const st = getSettings();
            const log = listMarkupLog({ customerId: c.id, limit: 20 });
            return (
              <>
                <FlashForm action={saveCustomerChannelMarkupAction} submitLabel="保存按渠道加价" className="card" id="channel-markup" review>
                  <h2 style={{ marginTop: 0 }}>{t("按渠道加价")}</h2>
                  <p className="small muted">{t("这个客户在某个渠道要加多一点或少一点时，在这里单独填；留空沿用上一级（客户专属加价 → 渠道加价 → 全局默认），灰字就是沿用的数值。")} {t("渠道有服务商返利时（设置 → 渠道），加价可以填负数，最低到 -返利%。")}</p>
                  <input type="hidden" name="id" value={c.id} />
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>{t("渠道")}</th><th>{t("加价 %")}</th><th>{t("固定加价")}</th><th>{t("最低利润")}</th><th>{t("实际生效")}</th><th className="num">{t("示例：成本 $10")}</th></tr></thead>
                      <tbody>
                        {open.map((ch) => {
                          const inherit = resolveRule(st.markup, ch.markup, c.markup);
                          const eff = effectiveRule(c.id, ch.code);
                          const mine = own[ch.code] ?? {};
                          const v = (x: number | null | undefined) => (x === null || x === undefined ? "" : String(x));
                          return (
                            <tr key={ch.code}>
                              <td>{ch.name}</td>
                              {(["percent", "fixed", "minProfit"] as const).map((k) => (
                                <td key={k}><input name={`${ch.code}.${k}`} type="number" step="0.01" min={k === "percent" ? undefined : 0} defaultValue={v(mine[k])} placeholder={String(inherit[k])} style={{ width: 90 }} /></td>
                              ))}
                              <td className="small">{signedPercent(eff.percent)}{eff.fixed ? ` + ${money(eff.fixed)}` : ""}<div className="muted">{t(MARKUP_SOURCE_LABEL[eff.source])}{ch.rebate > 0 && eff.source !== "promo" ? ` · ${t("返利 {n}%", { n: ch.rebate })}` : ""}</div>{eff.source !== "promo" && (mine.percent ?? 0) < 0 && !(ch.rebate > 0) && <div className="small warn-text" style={{ whiteSpace: "normal", maxWidth: 200 }}>{t("这个渠道没有设服务商返利，负数加价不会低于成本 + 最低利润")}</div>}{eff.source === "promo" && <div className="small warn-text" style={{ whiteSpace: "normal", maxWidth: 200 }}>{t("活动期间所有客户按限时活动价，左边的设置活动结束后才生效")}</div>}</td>
                              <td className="num">{money(computePrice(10, eff, st.roundingStep))}</td>
                            </tr>
                          );
                        })}
                        {!open.length && <tr><td colSpan={6} className="muted">{t("还没有开通渠道")}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </FlashForm>
                {log.length > 0 && (
                  <details className="card">
                    <summary><b>{t("加价修改记录（{n}）", { n: log.length })}</b></summary>
                    <table className="list" style={{ marginTop: 8 }}>
                      <tbody>
                        {log.map((l) => (
                          <tr key={l.id}>
                            <td className="small muted" style={{ whiteSpace: "nowrap" }}>{fmtTime(l.createdAt)}</td>
                            <td className="small">{l.label}</td>
                            <td className="small">{t(describeRule(l.before))} → <b>{t(describeRule(l.after))}</b></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </>
            );
          })()}

          {show("overview") && <FlashForm action={ledgerEntryAction} submitLabel="确认" className="card" resetOnSuccess review confirm={t("给【{name}】入账：提交后立即计入客户余额（当前余额 {bal}）。请核对类型和金额。", { name: c.name, bal: money(c.balance) })}>
              <h2>{staff ? t("充值") : t("充值 / 调账")}</h2>
              {staff && <p className="small muted" style={{ marginTop: -4 }}>{t("员工账号只能记充值；加款、扣款请找主管理员。确认人会记下你的名字。")}</p>}
              <input type="hidden" name="id" value={c.id} />
              <div className="grid" style={{ marginBottom: 12 }}>
                <label className="f">{t("类型")}
                  <select name="type" defaultValue="" required>
                    <option value="" disabled>{t("请选择")}</option>
                    <option value="topup">{t("充值（客户付款到账）")}</option>
                    {!staff && <option value="manual_add">{t("加款（补偿、赠送等）")}</option>}
                    {!staff && <option value="manual_sub">{t("扣款（从余额扣除）")}</option>}
                  </select>
                </label>
                <label className="f"><span className="req">{t("金额（填正数）")}</span><input name="amount" type="number" step="0.01" min="0.01" required /></label>
                <label className="f" style={{ gridColumn: "span 2" }}>{t("说明")}<input name="note" maxLength={200} placeholder={t("例如：9月转账 / 赔偿 / 月结账单")} /></label>
                <PinField />
              </div>
            </FlashForm>}

            {show("profile") && <div className="card">
              <h2>{t("客户端登录")}</h2>
              <FlashForm action={saveCustomerPortalAction} submitLabel="保存登录设置" review>
                <input type="hidden" name="id" value={c.id} />
                <div className="grid" style={{ marginBottom: 12 }}>
                  <label className="f" style={{ gridColumn: "span 2" }}>{t("登录邮箱")}<input name="portalEmail" type="email" defaultValue={c.portalEmail ?? c.email ?? ""} /></label>
                  <label className="f">{t("信用额度")}
                    <input name="creditLimit" type="number" step="0.01" min="0" defaultValue={c.creditLimit} disabled={staff} title={staff ? t("信用额度只有主管理员能改") : undefined} />
                  </label>
                  <label className="f" style={{ justifyContent: "flex-end" }}>
                    <span><input type="checkbox" name="portalEnabled" defaultChecked={c.portalEnabled} /> {t("允许客户登录")}</span>
                  </label>
                </div>
                <p className="small muted">{t("信用额度：余额可以透支到负多少。预付客户填 0；月结客户填一个额度。后台代客户下单也按这个额度检查。")}</p>
              </FlashForm>
              <div style={{ height: 16 }} />
              <FlashForm action={setCustomerPasswordAction} submitLabel={c.hasPassword ? "重新生成密码" : "生成登录密码"} submitClass="">
                <input type="hidden" name="id" value={c.id} />
                <label className="f" style={{ marginBottom: 8 }}>{t("新密码（至少 8 位；留空自动生成）")}<input name="password" type="text" autoComplete="off" minLength={8} /></label>
              </FlashForm>
              <p className="small muted">{t("把下面的地址和登录邮箱、密码发给客户，客户在自己的 OMS 里下单、充值、查看记录：")}<br /><code>{omsLogin}</code></p>
            </div>}

          {show("advanced") && <FlashForm action={saveCustomerStampAction} submitLabel="保存" className="card" review>
            <h2>{t("面单加印 SKU")}</h2>
            <input type="hidden" name="id" value={c.id} />
            <div className="row" style={{ marginBottom: 12 }}>
              <label className="f" style={{ minWidth: 260 }}>{t("这个客户的面单")}
                <select name="stampMode" defaultValue={c.stampMode}>
                  <option value="inherit">{t("跟随系统设置（{s}）", { s: stampSummary })}</option>
                  <option value="on">{t("加印 SKU")}</option>
                  <option value="off">{t("不加印")}</option>
                </select>
              </label>
              <span className="small muted">{t("位置和样式在“设置 → 面单加印 SKU”里调整。")}</span>
            </div>
          </FlashForm>}

          {show("profile") && !staff && !c.internal && <StaffAccessCard customerId={c.id} />}

          {show("profile") && <FlashForm action={saveCustomerSenderAction} submitLabel="保存寄件地址" className="card" review>
            <h2>{t("客户默认寄件地址")}</h2>
            <p className="small muted">{t("客户下单时默认使用这个地址；客户也可以在客户端的寄件地址簿里自己添加和修改。")}</p>
            <input type="hidden" name="id" value={c.id} />
            <AddressFields value={c.sender} namePrefix="sender." />
            <div style={{ height: 12 }} />
          </FlashForm>}

          {show("integrations") && <><StoresCard customerId={c.id} /><ApiCard customerId={c.id} /></>}

          {show("overview") && <div className="card table-wrap">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>{t("账户流水（最近 100 条）")}</h2>
              <span><Link href={`/customers/${c.id}/charges`}>{t("按订单扣款明细")}</Link> · <Link href={`/customers/${c.id}/statement`}>{t("对账单")}</Link>{!staff && <> · <Link href={`/shipments?customerId=${c.id}`}>{t("面单")}</Link></>}</span>
            </div>
            <table>
              <thead><tr><th>{t("时间")}</th><th>{t("类型")}</th><th>{t("单号")}</th><th>{t("说明")}</th><th>{t("操作人")}</th><th className="num">{t("金额")}</th><th className="num">{t("余额")}</th></tr></thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="small muted">{fmtTime(l.createdAt)}</td>
                    <td>{t(LEDGER_TYPE_LABEL[l.type])}</td>
                    <td>{l.shipmentId ? staff ? l.customNo : <Link href={`/shipments/${l.shipmentId}`}>{l.customNo}</Link> : "-"}</td>
                    <td className="small">{note(l.note)}</td>
                    <td className="small muted">{t(actorLabel(l.createdBy))}</td>
                    <td className={`num ${l.amount >= 0 ? "profit-pos" : ""}`}>{l.amount >= 0 ? "+" : ""}{money(l.amount)}</td>
                    <td className="num">{money(l.balanceAfter)}</td>
                  </tr>
                ))}
                {!ledger.length && <tr><td colSpan={7} className="muted">{t("还没有流水")}</td></tr>}
              </tbody>
            </table>
          </div>}
        </>
      )}
      </fieldset>
    </>
  );
}
