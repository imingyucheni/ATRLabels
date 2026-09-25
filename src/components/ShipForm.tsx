"use client";

import ChannelLabel, { useChannelDisplay } from "@/components/ChannelLabel";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { quoteAction } from "@/app/actions";
import type { SavedSender } from "@/lib/senders";
import { portalCreateAction, portalQuoteAction, saveSenderBookAction } from "@/app/portal/actions";
import type { PublicQuote } from "@/lib/portal";
import AddressFields, { SENDER_EXAMPLE } from "@/components/AddressFields";
import { useT, useTMsg } from "@/components/I18n";
import { money } from "@/lib/pricing";
import type { ChannelQuote } from "@/lib/service";
import type { Address, ShipmentRequest, UnitSystem } from "@/lib/shipbest/types";

type Sku = Record<"sku" | "productNameCn" | "productNameEn" | "quantity" | "declaredUnitPrice" | "hsCode" | "productNature", string>;

const emptySku = (): Sku => ({
  sku: "",
  productNameCn: "",
  productNameEn: "",
  quantity: "1",
  declaredUnitPrice: "",
  hsCode: "",
  productNature: "2,4",
});

const NATURE = [
  ["1", "带磁"],
  ["2", "不带磁"],
  ["3", "带电"],
  ["4", "不带电"],
  ["5", "液体"],
] as const;

/** 常用商品性质：大部分是普货（不带磁、不带电），特殊的再选 */
const NATURE_PRESETS = [
  { value: "2,4", label: "普货（无特殊）" },
  { value: "2,3", label: "带电" },
  { value: "1,4", label: "带磁" },
  { value: "1,3", label: "带磁 + 带电" },
  { value: "2,4,5", label: "液体" },
];

const UNIT_LABEL: Record<UnitSystem, [string, string]> = { 1: ["g", "cm"], 2: ["kg", "cm"], 3: ["lb", "in"] };

/** 报价行：后台看到完整信息（成本、利润），客户端只有价格 */
type Quote = PublicQuote & Partial<Pick<ChannelQuote, "cost" | "listCost" | "rule" | "profit">>;

export default function ShipForm(props: {
  /** portal = 客户自助下单：不选客户、只显示客户价 */
  mode?: "admin" | "portal";
  customers?: { id: number; name: string; balance?: number; available?: number; sender?: Address | null; channelCount?: number }[];
  defaultCustomerId?: number;
  defaultSender: Address | null;
  /** 客户端：寄件地址簿 */
  senders?: SavedSender[];
  defaultUnit: UnitSystem;
  defaultCurrency: string;
}) {
  const router = useRouter();
  const t = useT();
  const chName = useChannelDisplay();
  const tm = useTMsg();
  const portal = props.mode === "portal";
  const customers = props.customers ?? [];
  // 后台默认不选客户，避免替错客户下单
  const [customerId, setCustomerId] = useState<number>(props.defaultCustomerId ?? 0);
  const [customerRef, setCustomerRef] = useState("");
  // 后台试算新客户时临时填写的加价（留空 = 全局 / 渠道设置）
  const [markup, setMarkup] = useState({ percent: "", fixed: "", minProfit: "" });
  const initialCustomer = customers.find((c) => c.id === props.defaultCustomerId);
  const [sender, setSender] = useState<Partial<Address>>(
    props.senders?.find((x) => x.isDefault)?.address ??
      initialCustomer?.sender ??
      (props.defaultSender?.address1 ? props.defaultSender : { country: "US" }),
  );
  // 系统默认寄件地址（设置里的发货仓）要完整才能直接用
  const sysSender = props.defaultSender?.address1 && props.defaultSender?.zipCode ? props.defaultSender : null;
  const bookDefault = props.senders?.find((x) => x.isDefault);
  const [editSender, setEditSender] = useState(portal ? !bookDefault && !sysSender : !props.defaultSender);
  const [senders, setSenders] = useState<SavedSender[]>(props.senders ?? []);
  const [senderId, setSenderId] = useState<number | "new" | "system">(bookDefault?.id ?? (sysSender ? "system" : "new"));
  const [senderMsg, setSenderMsg] = useState<string | null>(null);
  const [savingSender, startSaveSender] = useTransition();
  const [recipient, setRecipient] = useState<Partial<Address>>({ country: "US" });
  const [unit, setUnit] = useState<UnitSystem>(props.defaultUnit);
  const [pkg, setPkg] = useState({ length: "", width: "", height: "", weight: "" });
  const [signType, setSignType] = useState(0);
  const [insurance, setInsurance] = useState({ on: false, fee: "" });
  const [currency, setCurrency] = useState(props.defaultCurrency);
  const [skus, setSkus] = useState<Sku[]>([emptySku()]);
  const [remark, setRemark] = useState("");

  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [quoting, startQuote] = useTransition();
  const [creating, setCreating] = useState<string | null>(null);

  const [wu, lu] = UNIT_LABEL[unit];

  // 表单内容变了，之前的报价作废
  const dirty = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setQuotes(null);
    setNotice(null);
  };

  function buildRequest(): ShipmentRequest {
    const num = (s: string) => Number(s) || 0;
    const totalQty = skus.reduce((a, s) => a + (num(s.quantity) || 1), 0) || 1;
    return {
      sender: sender as Address,
      recipient: recipient as Address,
      pkg: {
        length: num(pkg.length),
        width: num(pkg.width),
        height: num(pkg.height),
        weight: num(pkg.weight),
        displayUnitSystem: unit,
        signServiceType: signType as 0 | 1 | 2 | 3,
        insuranceService: insurance.on ? 1 : 0,
        insuranceFee: insurance.on ? num(insurance.fee) : undefined,
        currency,
      },
      // SKU 尺寸/重量用包裹数据按数量均摊（文档要求必填）
      skuList: skus.map((s) => ({
        sku: s.sku,
        productNameCn: s.productNameCn,
        productNameEn: s.productNameEn,
        quantity: num(s.quantity),
        declaredUnitPrice: num(s.declaredUnitPrice),
        declaredCurrency: currency,
        hsCode: s.hsCode,
        productNature: s.productNature,
        length: num(pkg.length),
        width: num(pkg.width),
        height: num(pkg.height),
        weight: Math.round((num(pkg.weight) / totalQty) * 1000) / 1000,
        unit,
      })),
    };
  }

  function onQuote() {
    setErrors([]);
    setNotice(null);
    startQuote(async () => {
      const optNum = (v: string) => (v.trim() === "" ? null : Number(v));
      const r = portal
        ? await portalQuoteAction(buildRequest())
        : await quoteAction(customerId, buildRequest(), { percent: optNum(markup.percent), fixed: optNum(markup.fixed), minProfit: optNum(markup.minProfit) });
      setErrors(r.errors ?? []);
      setQuotes(r.quotes ?? null);
    });
  }

  async function onCreate(q: Quote) {
    const msg = t("确认用 {channel} 出单？\n运费：{price}（从账户余额扣除）", { channel: chName(q.channelCode, q.channelName).name, price: money(q.price, q.currency) });
    if (!window.confirm(msg)) return;
    setCreating(q.channelCode);
    setErrors([]);
    try {
      const r = await portalCreateAction({ channelCode: q.channelCode, req: buildRequest(), expectedPrice: q.price!, remark, customerRef });
      if (r.id) {
        router.push(`/portal/shipments/${r.id}`);
        return;
      }
      if (r.quote) {
        // 价格变了：更新这一行，让员工重新确认
        setQuotes((qs) => qs?.map((x) => (x.channelCode === r.quote!.channelCode ? r.quote! : x)) ?? null);
        setNotice(r.error ?? null);
      } else {
        setErrors([r.error ?? t("出单失败")]);
      }
    } finally {
      setCreating(null);
    }
  }

  const setSku = (i: number, patch: Partial<Sku>) => dirty(setSkus)(skus.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const bestPrice = quotes?.filter((q) => q.ok).map((q) => q.price!)[0];

  const skuTable = (req: string) => (
    <>
            <div className="table-wrap">
              <table className="sku-table">
                <thead>
                  <tr><th>SKU{req}</th><th>{t("中文品名")}</th><th>{t("英文品名")}{req}</th><th>{t("数量")}{req}</th><th>{t("申报单价")}{req}</th><th>{t("海关编码")}</th><th>{t("商品性质")}{req}</th><th></th></tr>
                </thead>
                <tbody>
                  {skus.map((s, i) => (
                    <tr key={i}>
                      <td><input value={s.sku} onChange={(e) => setSku(i, { sku: e.target.value })} /></td>
                      <td><input value={s.productNameCn} placeholder={t("可不填，默认用英文品名")} onChange={(e) => setSku(i, { productNameCn: e.target.value })} /></td>
                      <td><input value={s.productNameEn} onChange={(e) => setSku(i, { productNameEn: e.target.value })} /></td>
                      <td style={{ width: 80 }}><input type="number" min="1" value={s.quantity} onChange={(e) => setSku(i, { quantity: e.target.value })} /></td>
                      <td style={{ width: 110 }}><input type="number" min="0" step="0.01" value={s.declaredUnitPrice} onChange={(e) => setSku(i, { declaredUnitPrice: e.target.value })} /></td>
                      <td style={{ width: 130 }}><input value={s.hsCode} onChange={(e) => setSku(i, { hsCode: e.target.value })} /></td>
                      <td style={{ minWidth: 170 }} className="small">
                        {(() => {
                          const preset = NATURE_PRESETS.find((p) => p.value === s.productNature)?.value ?? "custom";
                          return (
                            <>
                              <select value={preset} onChange={(e) => setSku(i, { productNature: e.target.value === "custom" ? s.productNature || "2,4" : e.target.value })}>
                                {NATURE_PRESETS.map((p) => <option key={p.value} value={p.value}>{t(p.label)}</option>)}
                                <option value="custom">{t("自定义…")}</option>
                              </select>
                              {preset === "custom" && (
                                <div style={{ marginTop: 4 }}>
                                  {NATURE.map(([code, label]) => {
                                    const set = new Set(s.productNature.split(",").filter(Boolean));
                                    return (
                                      <label key={code} style={{ marginRight: 8, whiteSpace: "nowrap" }}>
                                        <input
                                          type="checkbox"
                                          checked={set.has(code)}
                                          onChange={(e) => {
                                            // 带磁/不带磁、带电/不带电 互斥
                                            const opposite: Record<string, string> = { "1": "2", "2": "1", "3": "4", "4": "3" };
                                            if (e.target.checked) {
                                              set.add(code);
                                              if (opposite[code]) set.delete(opposite[code]);
                                            } else set.delete(code);
                                            setSku(i, { productNature: [...set].sort().join(",") });
                                          }}
                                        /> {t(label)}
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td>{skus.length > 1 && <button className="small danger" onClick={() => dirty(setSkus)(skus.filter((_, j) => j !== i))}>{t("删除")}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="small" style={{ marginTop: 8 }} onClick={() => dirty(setSkus)([...skus, emptySku()])}>{t("＋ 添加商品")}</button>
    </>
  );

  return (
    <>
      <div className="card">
        <div className="row">
          {!portal && (
            <label className="f" style={{ minWidth: 240 }}>
              <span>{t("按哪个客户的价格试算")}</span>
              <select
                value={customerId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  dirty(setCustomerId)(id);
                  // 换客户时带出该客户的默认寄件地址
                  const c = customers.find((x) => x.id === id);
                  setSender(c?.sender ?? props.defaultSender ?? {});
                }}
              >
                <option value={0}>{t("新客户 / 自定义加价")}</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {(() => {
                const c = customers.find((x) => x.id === customerId);
                return (
                  <>
                    {!c && <span className="small muted">{t("用所有已启用的渠道，按右边填写的加价试算")}</span>}
                    {c && <span className="small muted">{t("按这个客户已开通的渠道和他的加价试算")}</span>}
                    {c?.channelCount === 0 && (
                      <span className="small" style={{ color: "var(--warn)" }}>{t("未开通任何渠道，请先到")} <a href={`/customers/${c.id}#channels`}>{t("客户详情")}</a> {t("开通")}</span>
                    )}
                  </>
                );
              })()}
            </label>
          )}
          {portal ? (
            <>
              <label className="f" style={{ minWidth: 200 }}>
                {t("我的订单号（可选）")}
                <input value={customerRef} maxLength={50} onChange={(e) => setCustomerRef(e.target.value)} />
              </label>
              <label className="f" style={{ flex: 1 }}>
                {t("备注（可选）")}
                <input value={remark} maxLength={200} onChange={(e) => setRemark(e.target.value)} />
              </label>
            </>
          ) : customerId === 0 ? (
            <>
              <label className="f" style={{ width: 120 }}>{t("加价 %")}<input type="number" min="0" step="0.01" value={markup.percent} placeholder={t("全局设置")} onChange={(e) => setMarkup({ ...markup, percent: e.target.value })} /></label>
              <label className="f" style={{ width: 120 }}>{t("每单固定加价")}<input type="number" min="0" step="0.01" value={markup.fixed} placeholder={t("全局设置")} onChange={(e) => setMarkup({ ...markup, fixed: e.target.value })} /></label>
              <label className="f" style={{ width: 120 }}>{t("每单最低利润")}<input type="number" min="0" step="0.01" value={markup.minProfit} placeholder={t("全局设置")} onChange={(e) => setMarkup({ ...markup, minProfit: e.target.value })} /></label>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>{t("寄件人")}</h2>
            {!editSender && <button className="small" onClick={() => setEditSender(true)}>{t("修改")}</button>}
          </div>
          {portal && (
            <div className="sender-pick">
              <select
                value={senderId}
                onChange={(e) => {
                  const v = e.target.value;
                  setSenderMsg(null);
                  if (v === "new") {
                    setSenderId("new");
                    dirty(setSender)({ country: "US" });
                    setEditSender(true);
                  } else if (v === "system") {
                    setSenderId("system");
                    dirty(setSender)(sysSender ?? {});
                    setEditSender(false);
                  } else {
                    const hit = senders.find((x) => x.id === Number(v));
                    setSenderId(Number(v));
                    if (hit) dirty(setSender)(hit.address);
                    setEditSender(false);
                  }
                }}
              >
                {senders.map((x) => <option key={x.id} value={x.id}>{x.label}{x.isDefault ? t("（默认）") : ""}</option>)}
                {sysSender && <option value="system">{t("发货仓地址（{city}）", { city: sysSender.city })}</option>}
                <option value="new">{t("＋ 新增寄件地址…")}</option>
              </select>
              <a className="small" href="/portal/account">{t("管理地址簿")}</a>
            </div>
          )}
          {portal && !senders.length && senderId === "new" && (
            <p className="small muted" style={{ margin: "0 0 10px" }}>{t("还没有保存寄件地址。填好后点“保存到寄件地址簿”，下次就可以直接选择。")}</p>
          )}
          {editSender ? (
            <>
              <AddressFields value={sender} placeholders={portal ? SENDER_EXAMPLE : undefined} onChange={(a) => { dirty(setSender)(a); setSenderMsg(null); }} />
              {portal && (
                <div className="row" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="small"
                    disabled={savingSender}
                    onClick={() =>
                      startSaveSender(async () => {
                        const editingId = typeof senderId === "number" ? senderId : undefined; // 发货仓 / 新地址 → 新增一条
                        const r = await saveSenderBookAction({ id: editingId, address: sender, label: senders.find((x) => x.id === editingId)?.label });
                        if (r.error) return setSenderMsg(tm(r.error));
                        setSenders(r.senders!);
                        setSenderId(r.id!);
                        setEditSender(false);
                        setSenderMsg(editingId ? t("已更新地址簿里的这个地址") : t("已保存到寄件地址簿，下次可以直接选择"));
                      })
                    }
                  >
                    {savingSender ? t("保存中…") : typeof senderId === "number" ? t("更新到地址簿") : t("保存到寄件地址簿")}
                  </button>
                  <span className="small muted">{t("不保存也可以直接下单")}</span>
                </div>
              )}
            </>
          ) : (
            <div className="sender-summary">
              <div><b>{[sender.nameFirst, sender.nameLast].filter(Boolean).join(" ")}</b>{sender.corporateName ? ` · ${sender.corporateName}` : ""}{sender.phone ? ` · ${sender.phone}` : ""}</div>
              <div className="muted">{[sender.address1, sender.address2, [sender.city, sender.province, sender.zipCode].filter(Boolean).join(" "), sender.country].filter(Boolean).join(", ")}</div>
            </div>
          )}
          {senderMsg && <div className="small" style={{ marginTop: 8, color: "var(--accent)" }}>{senderMsg}</div>}
        </div>
        <div className="card">
          <h2>{t("收件人")}</h2>
          <AddressFields value={recipient} onChange={dirty(setRecipient)} />
        </div>
      </div>

      <div className="card">
        <h2>{t("包裹")}</h2>
        <div className="grid">
          <label className="f">{t("单位")}
            <select value={unit} onChange={(e) => dirty(setUnit)(Number(e.target.value) as UnitSystem)}>
              <option value={3}>lb / in</option>
              <option value={2}>kg / cm</option>
              <option value={1}>g / cm</option>
            </select>
          </label>
          {(["length", "width", "height"] as const).map((k) => (
            <label key={k} className="f"><span className="req">{t({ length: "长（{u}）", width: "宽（{u}）", height: "高（{u}）" }[k], { u: lu })}</span>
              <input type="number" min="0" step="0.01" value={pkg[k]} onChange={(e) => dirty(setPkg)({ ...pkg, [k]: e.target.value })} />
            </label>
          ))}
          <label className="f"><span className="req">{t("重量（{u}）", { u: wu })}</span>
            <input type="number" min="0" step="0.001" value={pkg.weight} onChange={(e) => dirty(setPkg)({ ...pkg, weight: e.target.value })} />
          </label>
          <label className="f">{t("签名服务")}
            <select value={signType} onChange={(e) => dirty(setSignType)(Number(e.target.value))}>
              <option value={0}>{t("不需要签名")}</option>
              <option value={1}>{t("直接签名")}</option>
              <option value={2}>{t("间接签名")}</option>
              <option value={3}>{t("成人签名")}</option>
            </select>
          </label>
          <label className="f">{t("币种")}<input value={currency} maxLength={3} onChange={(e) => dirty(setCurrency)(e.target.value.toUpperCase())} /></label>
          <label className="f">{t("保险")}
            <select value={insurance.on ? 1 : 0} onChange={(e) => dirty(setInsurance)({ ...insurance, on: e.target.value === "1" })}>
              <option value={0}>{t("不需要")}</option>
              <option value={1}>{t("需要")}</option>
            </select>
          </label>
          {insurance.on && (
            <label className="f"><span className="req">{t("保险金额")}</span>
              <input type="number" min="0" step="0.01" value={insurance.fee} onChange={(e) => dirty(setInsurance)({ ...insurance, fee: e.target.value })} />
            </label>
          )}
        </div>

        {portal ? (
          <>
            <h3>{t("商品明细（报关用）")}</h3>
            {skuTable(" *")}
          </>
        ) : (
          // 后台试算只看地址和包裹：商品明细默认收起，不填也能试算
          <details style={{ marginTop: 12 }}>
            <summary className="small muted" style={{ cursor: "pointer" }}>{t("商品明细（可选：试算运费不需要填写）")}</summary>
            {skuTable("")}
          </details>
        )}
      </div>

      {errors.length > 0 && (
        <div className="alert err"><ul>{errors.map((e, i) => <li key={i}>{tm(e)}</li>)}</ul></div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: quotes ? 12 : 0 }}>
          <h2 style={{ margin: 0 }}>{t("报价")}</h2>
          <button className="primary" onClick={onQuote} disabled={quoting}>
            {quoting ? t("查询中…") : quotes ? t("重新查询运费") : t("查询运费")}
          </button>
        </div>
        {notice && <div className="alert warn">{tm(notice)}</div>}
        {quotes && (
          <div className="row small" style={{ justifyContent: "space-between", marginBottom: 8, alignItems: "center" }}>
            <span className="muted">
              {t("{n} 个渠道可以送达", { n: quotes.filter((q) => q.ok).length })}
              {quotes.some((q) => !q.ok) && t("，{n} 个渠道地址未覆盖或不可用（{list}）", { n: quotes.filter((q) => !q.ok).length, list: quotes.filter((q) => !q.ok).map((q) => chName(q.channelCode, q.channelName).name).join(t("、")) })}
            </span>
            <label><input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} /> {t("只显示可下单渠道")}</label>
          </div>
        )}
        {quotes && !quotes.some((q) => q.ok) && <div className="alert err">{t("所有渠道都不支持这个地址或包裹，请检查邮编、地址或重量尺寸。")}</div>}
        {quotes && (
          <div className="table-wrap">
            <table>
              <thead>
                {portal ? (
                  <tr><th>{t("渠道")}</th><th>{t("分区")}</th><th className="num">{t("运费")}</th><th></th></tr>
                ) : (
                  <tr><th>{t("渠道")}</th><th>{t("分区")}</th><th className="num">{t("原价")}</th><th className="num">{t("我们的成本")}</th><th>{t("加价规则")}</th><th className="num">{t("客户价")}</th><th className="num">{t("利润")}</th></tr>
                )}
              </thead>
              <tbody>
                {quotes.filter((q) => q.ok || !onlyAvailable).map((q) =>
                  q.ok ? (
                    <tr key={q.channelCode} className={q.price === bestPrice ? "best" : ""}>
                      <td><ChannelLabel code={q.channelCode} name={q.channelName} size="md" />{!portal && <div className="small muted">{q.channelCode}</div>}</td>
                      <td>{q.zone ?? "-"}</td>
                      {!portal && (
                        <>
                          <td className="num muted">{money(q.listCost)}</td>
                          <td className="num">{money(q.cost, q.currency)}</td>
                          <td className="small">+{q.rule!.percent}% + {q.rule!.fixed}{t("，最低利润")} {q.rule!.minProfit}</td>
                        </>
                      )}
                      <td className="num"><b>{money(q.price, q.currency)}</b></td>
                      {!portal && <td className="num profit-pos">{money(q.profit)}</td>}
                      {portal && (
                        <td>
                          <button className="primary small" disabled={!!creating} onClick={() => onCreate(q)}>
                            {creating === q.channelCode ? t("出单中…") : t("用此渠道出单")}
                          </button>
                        </td>
                      )}
                    </tr>
                  ) : (
                    <tr key={q.channelCode}>
                      <td><ChannelLabel code={q.channelCode} name={q.channelName} /></td>
                      <td colSpan={portal ? 3 : 6} className="small" style={{ color: "var(--err)" }}>
                        <b>{/不通邮|派送范围|未覆盖/.test(q.error ?? "") ? t("地址未覆盖") : t("不可用")}</b>
                        {q.error && !/^地址未覆盖/.test(q.error) ? `${t("：")}${tm(q.error)}` : q.error ? `${t("：")}${tm(q.error.replace(/^地址未覆盖：/, ""))}` : ""}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
