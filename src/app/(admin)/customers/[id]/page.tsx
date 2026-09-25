import { fmtTime } from "@/lib/time";
import Link from "next/link";
import { headers } from "next/headers";
import { omsLoginUrl } from "@/lib/sites";
import { pendingCredentials } from "@/lib/credentials";
import CredentialsCard from "@/components/CredentialsCard";
import { notFound } from "next/navigation";
import { customerChannelCodes, getCustomer, getSettings, listChannels } from "@/lib/db";
import FlashForm from "@/components/FlashForm";
import RuleInputs from "@/components/RuleInputs";
import AddressFields from "@/components/AddressFields";
import { LEDGER_TYPE_LABEL, listLedger } from "@/lib/ledger";
import { money } from "@/lib/pricing";
import { getT, getLang } from "@/lib/prefs";
import { translateMessage } from "@/lib/i18n";
import { ledgerEntryAction, hideCredentialsAction, saveCustomerAction, saveCustomerChannelsAction, saveCustomerPortalAction, saveCustomerSenderAction, saveCustomerStampAction, setCustomerPasswordAction } from "@/app/actions";

export default async function CustomerEdit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = id === "new" ? null : getCustomer(Number(id));
  if (id !== "new" && !c) notFound();
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
          {c && <a className="btn primary" href={`/api/customers/${c.id}/oms`}>{t("进入客户 OMS")}</a>}
          <Link href="/customers">{t("← 返回")}</Link>
        </div>
      </div>
      {c && creds && (
        <CredentialsCard brand={getSettings().brandName} name={c.name} url={omsLogin} email={creds.email} password={creds.password}
          onHide={hideCredentialsAction.bind(null, c.id)} noChannels={!usable} />
      )}
      <FlashForm action={saveCustomerAction} submitLabel={c ? "保存" : "创建客户并生成登录信息"} className="card" review={!!c}>
        <input type="hidden" name="id" value={c?.id ?? ""} />
        <div className="grid">
          <label className="f"><span className="req">{t("名称")}</span><input name="name" required defaultValue={c?.name} /></label>
          <label className="f">{t("联系人")}<input name="contact" defaultValue={c?.contact ?? ""} /></label>
          <label className="f">{t("电话")}<input name="phone" defaultValue={c?.phone ?? ""} /></label>
          <label className="f">{c ? t("邮箱") : <span className="req">{t("邮箱（客户 OMS 登录账号）")}</span>}<input name="email" type="email" required={!c} defaultValue={c?.email ?? ""} /></label>
        </div>
        <h3>{t("专属加价（留空 = 沿用渠道 / 全局设置）")}</h3>
        <div className="grid">
          <RuleInputs value={c?.markup} placeholder={{ percent: t("默认 {v}", { v: markup.percent }), fixed: t("默认 {v}", { v: markup.fixed }), minProfit: t("默认 {v}", { v: markup.minProfit }) }} />
        </div>
        <label className="f" style={{ margin: "12px 0" }}>{t("备注")}<textarea name="note" rows={2} defaultValue={c?.note ?? ""} /></label>
      </FlashForm>
      {c && (
        <>
          <div className="stats">
            <div className="stat"><div className="muted">{t("账户余额")}</div><div className={`v ${c.balance < 0 ? "profit-neg" : ""}`}>{money(c.balance)}</div></div>
            <div className="stat"><div className="muted">{t("信用额度")}</div><div className="v">{money(c.creditLimit)}</div></div>
            <div className="stat"><div className="muted">{t("可用额度")}</div><div className="v">{money(c.balance + c.creditLimit)}</div></div>
            <div className="stat"><div className="muted">{t("客户端登录")}</div><div className="v" style={{ fontSize: 16 }}>{c.portalEnabled ? (c.hasPassword ? t("已开通") : t("未设密码")) : t("未开通")}</div></div>
          </div>

          <FlashForm action={saveCustomerChannelsAction} submitLabel="保存渠道" className="card" id="channels" review>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>{t("可用渠道")}</h2>
              <span className={`badge ${usable ? "ok" : "warn"}`}>{usable ? t("已开通 {n} 个", { n: usable }) : t("未开通，客户无法下单")}</span>
            </div>
            <p className="small muted">{t("新客户默认不开通任何渠道。勾选后客户才能用这些渠道查询运费、下单和批量导入；后台代下单也只能用这里开通的渠道。")}</p>
            <input type="hidden" name="id" value={c.id} />
            <div className="check-grid" style={{ margin: "8px 0 12px" }}>
              {allChannels.map((ch) => (
                <label key={ch.code} className={`check-tile ${ch.enabled ? "" : "disabled"}`}>
                  <input type="checkbox" name="channels" value={ch.code} defaultChecked={opened.has(ch.code)} />
                  <span>
                    <b>{ch.name}</b>
                    <span className="small muted">{ch.code}{ch.enabled ? "" : t(" · 设置里已停用，暂不可用")}</span>
                  </span>
                </label>
              ))}
              {!allChannels.length && <span className="small muted">{t("还没有渠道，请先到")} <Link href="/settings">{t("设置")}</Link> {t("同步渠道。")}</span>}
            </div>
          </FlashForm>

          <div className="grid2">
            <FlashForm action={ledgerEntryAction} submitLabel="确认" className="card" resetOnSuccess confirm="确认提交这笔充值 / 调账？提交后会立即计入客户余额。">
              <h2>{t("充值 / 调账")}</h2>
              <input type="hidden" name="id" value={c.id} />
              <div className="grid" style={{ marginBottom: 12 }}>
                <label className="f">{t("类型")}
                  <select name="type" defaultValue="topup">
                    <option value="topup">{t("充值（客户付款到账）")}</option>
                    <option value="manual">{t("手动调账（正数加、负数扣）")}</option>
                  </select>
                </label>
                <label className="f"><span className="req">{t("金额")}</span><input name="amount" type="number" step="0.01" required /></label>
                <label className="f" style={{ gridColumn: "span 2" }}>{t("说明")}<input name="note" maxLength={200} placeholder={t("例如：9月转账 / 赔偿 / 月结账单")} /></label>
              </div>
            </FlashForm>

            <div className="card">
              <h2>{t("客户端登录")}</h2>
              <FlashForm action={saveCustomerPortalAction} submitLabel="保存登录设置" review>
                <input type="hidden" name="id" value={c.id} />
                <div className="grid" style={{ marginBottom: 12 }}>
                  <label className="f" style={{ gridColumn: "span 2" }}>{t("登录邮箱")}<input name="portalEmail" type="email" defaultValue={c.portalEmail ?? c.email ?? ""} /></label>
                  <label className="f">{t("信用额度")}
                    <input name="creditLimit" type="number" step="0.01" min="0" defaultValue={c.creditLimit} />
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
            </div>
          </div>

          <FlashForm action={saveCustomerStampAction} submitLabel="保存" className="card" review>
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
          </FlashForm>

          <FlashForm action={saveCustomerSenderAction} submitLabel="保存寄件地址" className="card" review>
            <h2>{t("客户默认寄件地址")}</h2>
            <p className="small muted">{t("客户下单时默认使用这个地址；客户也可以在客户端的寄件地址簿里自己添加和修改。")}</p>
            <input type="hidden" name="id" value={c.id} />
            <AddressFields value={c.sender} namePrefix="sender." />
            <div style={{ height: 12 }} />
          </FlashForm>

          <div className="card table-wrap">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>{t("账户流水（最近 100 条）")}</h2>
              <span><Link href={`/customers/${c.id}/charges`}>{t("按订单扣款明细")}</Link> · <Link href={`/customers/${c.id}/statement`}>{t("对账单")}</Link> · <Link href={`/shipments?customerId=${c.id}`}>{t("面单")}</Link></span>
            </div>
            <table>
              <thead><tr><th>{t("时间")}</th><th>{t("类型")}</th><th>{t("单号")}</th><th>{t("说明")}</th><th>{t("操作人")}</th><th className="num">{t("金额")}</th><th className="num">{t("余额")}</th></tr></thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="small muted">{fmtTime(l.createdAt)}</td>
                    <td>{t(LEDGER_TYPE_LABEL[l.type])}</td>
                    <td>{l.shipmentId ? <Link href={`/shipments/${l.shipmentId}`}>{l.customNo}</Link> : "-"}</td>
                    <td className="small">{note(l.note)}</td>
                    <td className="small muted">{l.createdBy === "customer" ? t("客户") : l.createdBy === "system" ? t("系统") : t("后台")}</td>
                    <td className={`num ${l.amount >= 0 ? "profit-pos" : ""}`}>{l.amount >= 0 ? "+" : ""}{money(l.amount)}</td>
                    <td className="num">{money(l.balanceAfter)}</td>
                  </tr>
                ))}
                {!ledger.length && <tr><td colSpan={7} className="muted">{t("还没有流水")}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
