"use client";

import ChannelLabel, { useChannelDisplay } from "@/components/ChannelLabel";
import AddressCheckPanel from "@/components/AddressCheckPanel";
import type { AddressCheck } from "@/lib/addressCheck";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { houseCreateAction, houseQuoteAction, quoteAction, resubmitCreateAction, resubmitQuoteAction } from "@/app/actions";
import type { SavedSender } from "@/lib/senders";
import { portalCreateAction, portalQuoteAction, portalReorderAction, saveSenderBookAction } from "@/app/portal/actions";
import type { PublicQuote } from "@/lib/portal";
import AddressFields, { SENDER_EXAMPLE } from "@/components/AddressFields";
import { useT, useTMsg } from "@/components/I18n";
import { money, signedPercent } from "@/lib/pricing";
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
type Quote = PublicQuote & Partial<Pick<ChannelQuote, "cost" | "listCost" | "rule" | "profit" | "zoneEstimated">>;

/** 异常单修改后重新下单：原订单的信息（预填到表单里） */
export interface ResubmitSource {
  id: number;
  customerName: string;
  /** 公司自用账户（成本价） */
  house: boolean;
  channelCode: string;
  request: ShipmentRequest;
  remark: string | null;
  customerRef: string | null;
  /** 原单是已取消的（取消后重新下单），不是出单异常 */
  cancelled?: boolean;
  /** 出单成功后回到哪里（例如批量下单的批次页）；不填就打开新单 */
  returnTo?: string;
}

/** 数字转成输入框里的文字（0 / 空显示为空） */
const numText = (v: number | null | undefined) => (v ? String(v) : "");

export default function ShipForm(props: {
  /** portal = 客户自助下单：不选客户、只显示客户价；house = 管理员按成本价下单（所有渠道）；resubmit = 异常单修改后重新下单 */
  mode?: "admin" | "portal" | "house" | "resubmit";
  resubmit?: ResubmitSource;
  /** 客户端：已取消的订单重新下单（预填原单信息，出单后批次里的这一行换成新单） */
  reorder?: { id: number; request: ShipmentRequest; customerRef: string | null; remark: string | null; returnTo?: string };
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
  const house = props.mode === "house";
  const re = props.mode === "resubmit" ? props.resubmit : undefined;
  // 按成本价出单的表格样式：管理员自用，或者重新下单的原单就是公司自用
  const costTable = house || !!re?.house;
  // 可以直接出单的模式（客户自助 / 管理员自用 / 异常单重新下单）
  const orderable = portal || house || !!re;
  const reorder = portal ? props.reorder : undefined;
  const init = re?.request ?? reorder?.request;
  const customers = props.customers ?? [];
  // 后台默认不选客户，避免替错客户下单
  const [customerId, setCustomerId] = useState<number>(props.defaultCustomerId ?? 0);
  const [customerRef, setCustomerRef] = useState(re?.customerRef ?? reorder?.customerRef ?? "");
  // 后台试算新客户时临时填写的加价（留空 = 全局 / 渠道设置）
  const [markup, setMarkup] = useState({ percent: "", fixed: "", minProfit: "" });
  const initialCustomer = customers.find((c) => c.id === props.defaultCustomerId);
  const [sender, setSender] = useState<Partial<Address>>(
    init?.sender ??
    props.senders?.find((x) => x.isDefault)?.address ??
      initialCustomer?.sender ??
      (props.defaultSender?.address1 ? props.defaultSender : { country: "US" }),
  );
  // 系统默认寄件地址（设置里的发货仓）要完整才能直接用
  const sysSender = props.defaultSender?.address1 && props.defaultSender?.zipCode ? props.defaultSender : null;
  const bookDefault = props.senders?.find((x) => x.isDefault);
  const [editSender, setEditSender] = useState(portal ? !bookDefault && !sysSender : re ? false : !props.defaultSender);
  const [senders, setSenders] = useState<SavedSender[]>(props.senders ?? []);
  const [senderId, setSenderId] = useState<number | "new" | "system">(bookDefault?.id ?? (sysSender ? "system" : "new"));
  const [senderMsg, setSenderMsg] = useState<string | null>(null);
  const [savingSender, startSaveSender] = useTransition();
  const [recipient, setRecipient] = useState<Partial<Address>>(init?.recipient ?? { country: "US" });
  const [unit, setUnit] = useState<UnitSystem>(init?.pkg.displayUnitSystem ?? props.defaultUnit);
  const [pkg, setPkg] = useState(
    init
      ? { length: numText(init.pkg.length), width: numText(init.pkg.width), height: numText(init.pkg.height), weight: numText(init.pkg.weight) }
      : { length: "", width: "", height: "", weight: "" },
  );
  const [signType, setSignType] = useState<number>(init?.pkg.signServiceType ?? 0);
  const [insurance, setInsurance] = useState({ on: !!init?.pkg.insuranceService, fee: numText(init?.pkg.insuranceFee) });
  const [currency, setCurrency] = useState(init?.pkg.currency || props.defaultCurrency);
  const [skus, setSkus] = useState<Sku[]>(
    init?.skuList.length
      ? init.skuList.map((k) => ({
          sku: k.sku ?? "",
          productNameCn: k.productNameCn ?? "",
          productNameEn: k.productNameEn ?? "",
          quantity: String(k.quantity || 1),
          declaredUnitPrice: numText(k.declaredUnitPrice),
          hsCode: k.hsCode ?? "",
          productNature: k.productNature || "2,4",
        }))
      : [emptySku()],
  );
  const [remark, setRemark] = useState(re?.remark ?? reorder?.remark ?? "");

  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  // 默认显示全部渠道：送不到的也列出来（灰色、不能选、显示原因）
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [quoting, startQuote] = useTransition();
  const [creating, setCreating] = useState<string | null>(null);
  // 收件地址核对（USPS）
  const [addr, setAddr] = useState<AddressCheck | null>(null);
  const [addrAck, setAddrAck] = useState(false);
  const [requote, setRequote] = useState(false);

  const [wu, lu] = UNIT_LABEL[unit];

  // 表单内容变了，之前的报价作废
  const dirty = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setQuotes(null);
    setNotice(null);
    setAddr(null);
    setAddrAck(false);
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
        : re
          ? await resubmitQuoteAction(re.id, buildRequest())
        : house
          ? await houseQuoteAction(buildRequest())
          : await quoteAction(customerId, buildRequest(), { percent: optNum(markup.percent), fixed: optNum(markup.fixed), minProfit: optNum(markup.minProfit) });
      setErrors(r.errors ?? []);
      setQuotes(r.quotes ?? null);
      setAddr(("address" in r && r.address) || null);
      setAddrAck(false);
    });
  }

  // 采用 USPS 建议地址后自动重新查询
  useEffect(() => {
    if (requote) {
      setRequote(false);
      onQuote();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requote]);

  const addrNeedsAck = !!addr && ["missing_unit", "bad_unit", "not_found"].includes(addr.status);

  async function onCreate(q: Quote) {
    if (addrNeedsAck && !addrAck) {
      setErrors([t("收件地址可能有问题，请检查地址，或勾选“我确认地址无误”后再下单")]);
      document.getElementById("addr-check")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const msg = re?.cancelled
      ? t("确认用 {channel} 重新出单？\n{who}：{price}", { channel: q.channelName, who: re.house ? t("成本价") : t("客户价"), price: money(q.price, q.currency) })
      : re
      ? t("确认用 {channel} 重新出单？\n{who}：{price}\n出单成功后，原异常单会自动取消，费用退回。", { channel: q.channelName, who: re.house ? t("成本价") : t("客户价"), price: money(q.price, q.currency) })
      : house
      ? t("确认用 {channel} 出单？\n成本价：{price}（公司自用，不扣客户余额）", { channel: q.channelName, price: money(q.price, q.currency) })
      : t("确认用 {channel} 出单？\n运费：{price}（从账户余额扣除）", { channel: chName(q.channelCode, q.channelName).name, price: money(q.price, q.currency) });
    if (!window.confirm(msg)) return;
    setCreating(q.channelCode);
    setErrors([]);
    try {
      const args = { channelCode: q.channelCode, req: buildRequest(), expectedPrice: q.price!, remark, customerRef, addressAck: addrAck };
      const r = re ? await resubmitCreateAction({ ...args, oldId: re.id }) : house ? await houseCreateAction(args) : reorder ? await portalReorderAction({ ...args, oldId: reorder.id }) : await portalCreateAction(args);
      if (r.id) {
        router.push(re?.returnTo ?? reorder?.returnTo ?? (house || re ? `/shipments/${r.id}` : `/portal/shipments/${r.id}`));
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
                      <td data-label={`SKU${req}`}><input value={s.sku} onChange={(e) => setSku(i, { sku: e.target.value })} /></td>
                      <td data-label={t("中文品名")}><input value={s.productNameCn} placeholder={t("可不填，默认用英文品名")} onChange={(e) => setSku(i, { productNameCn: e.target.value })} /></td>
                      <td data-label={t("英文品名") + req}><input value={s.productNameEn} onChange={(e) => setSku(i, { productNameEn: e.target.value })} /></td>
                      <td data-label={t("数量") + req} style={{ width: 80 }}><input type="number" min="1" value={s.quantity} onChange={(e) => setSku(i, { quantity: e.target.value })} /></td>
                      <td data-label={t("申报单价") + req} style={{ width: 110 }}><input type="number" min="0" step="0.01" value={s.declaredUnitPrice} onChange={(e) => setSku(i, { declaredUnitPrice: e.target.value })} /></td>
                      <td data-label={t("海关编码")} style={{ width: 130 }}><input value={s.hsCode} onChange={(e) => setSku(i, { hsCode: e.target.value })} /></td>
                      <td data-label={t("商品性质") + req} style={{ minWidth: 170 }} className="small full">
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
                      <td className="full">{skus.length > 1 && <button className="small danger" onClick={() => dirty(setSkus)(skus.filter((_, j) => j !== i))}>{t("删除")}</button>}</td>
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
          {!orderable && (
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
          {orderable ? (
            <>
              {re && (
                <label className="f" style={{ minWidth: 180 }}>
                  {t("客户")}
                  <input value={re.customerName} disabled />
                </label>
              )}
              <label className="f" style={{ minWidth: 200 }}>
                {house || re ? t("订单号（可选）") : t("我的订单号（可选）")}
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

        {orderable ? (
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
        {orderable && addr && addr.status !== "unavailable" && addr.status !== "skipped" && (
          <AddressCheckPanel
            check={addr}
            ack={addrAck}
            onAck={setAddrAck}
            onUse={(sug) => {
              setRecipient({ ...recipient, ...sug });
              setAddr(null);
              setRequote(true);
            }}
          />
        )}
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
            <table className={portal || costTable || re ? "quote-table" : undefined}>
              <thead>
                {portal ? (
                  <tr><th>{t("渠道")}</th><th>{t("分区")}</th><th className="num">{t("运费")}</th><th></th></tr>
                ) : costTable ? (
                  <tr><th>{t("渠道")}</th><th>{t("分区")}</th><th className="num">{t("原价")}</th><th className="num">{t("成本价（出单价）")}</th><th></th></tr>
                ) : re ? (
                  <tr><th>{t("渠道")}</th><th>{t("分区")}</th><th className="num">{t("我们的成本")}</th><th className="num">{t("客户价（出单价）")}</th><th></th></tr>
                ) : (
                  <tr><th>{t("渠道")}</th><th>{t("分区")}</th><th className="num">{t("原价")}</th><th className="num">{t("我们的成本")}</th><th>{t("加价规则")}</th><th className="num">{t("客户价")}</th><th className="num">{t("利润")}</th></tr>
                )}
              </thead>
              <tbody>
                {quotes.filter((q) => q.ok || !onlyAvailable).map((q) =>
                  q.ok ? (
                    costTable || re ? (
                      <tr key={q.channelCode} className={q.price === bestPrice ? "best" : ""}>
                        <td className="q-ch">
                          <ChannelLabel code={q.channelCode} name={q.channelName} size="md" />
                          <div className="small muted">{q.channelCode}{re?.channelCode === q.channelCode && <span className="badge pending" style={{ marginLeft: 6 }}>{t("原渠道")}</span>}</div>
                        </td>
                        <td className="q-zone" data-label={t("分区")}>{q.zone ?? "-"}{q.zoneEstimated && <span className="small muted" title={t("嘉谷未返回分区，按同一目的地其他渠道的分区估算")}>{t("（参考）")}</span>}</td>
                        <td className="num muted q-cost" data-label={costTable ? t("原价") : t("我们的成本")}>{money(costTable ? q.listCost : q.cost)}</td>
                        <td className="num q-price"><b>{money(q.price, q.currency)}</b>{q.price === bestPrice && <div className="small profit-pos">{t("最低")}</div>}{q.promo && <div className="small" style={{ textAlign: "right" }}><span className="badge promo">{tm(q.promo.label)}</span> <s className="muted">{money(q.promo.originalPrice, q.currency)}</s><div className="muted">{t("活动至 {d}", { d: q.promo.endsOn.slice(5) })}</div></div>}{q.warning && <div className="small warn-text" style={{ maxWidth: 260, marginLeft: "auto", textAlign: "left" }}>⚠ {tm(q.warning)}</div>}</td>
                        <td className="q-act">
                          <button className="primary small" disabled={!!creating} onClick={() => onCreate(q)}>
                            {creating === q.channelCode ? t("出单中…") : re ? t("用此渠道重新出单") : t("用此渠道出单")}
                          </button>
                        </td>
                      </tr>
                    ) :
                    <tr key={q.channelCode} className={q.price === bestPrice ? "best" : ""}>
                      <td className="q-ch"><ChannelLabel code={q.channelCode} name={q.channelName} size="md" />{!portal && <div className="small muted">{q.channelCode}</div>}</td>
                      <td className="q-zone" data-label={t("分区")}>{q.zone ?? "-"}{!portal && q.zoneEstimated && <span className="small muted" title={t("嘉谷未返回分区，按同一目的地其他渠道的分区估算")}>{t("（参考）")}</span>}</td>
                      {!portal && (
                        <>
                          <td className="num muted">{money(q.listCost)}</td>
                          <td className="num">{money(q.cost, q.currency)}</td>
                          <td className="small">{signedPercent(q.rule!.percent)} + {q.rule!.fixed}{t("，最低利润")} {q.rule!.minProfit}</td>
                        </>
                      )}
                      <td className="num q-price"><b>{money(q.price, q.currency)}</b>{q.promo && <div className="small" style={{ textAlign: "right" }}><span className="badge promo">{tm(q.promo.label)}</span> <s className="muted">{money(q.promo.originalPrice, q.currency)}</s><div className="muted">{t("活动至 {d}", { d: q.promo.endsOn.slice(5) })}</div></div>}{q.warning && <div className="small warn-text" style={{ maxWidth: 260, marginLeft: "auto", textAlign: "left" }}>⚠ {tm(q.warning)}</div>}</td>
                      {!portal && <td className="num profit-pos">{money(q.profit)}</td>}
                      {portal && (
                        <td className="q-act">
                          <button className="primary small" disabled={!!creating} onClick={() => onCreate(q)}>
                            {creating === q.channelCode ? t("出单中…") : t("用此渠道出单")}
                          </button>
                        </td>
                      )}
                    </tr>
                  ) : (
                    <tr key={q.channelCode} className="row-disabled">
                      <td className="q-ch"><ChannelLabel code={q.channelCode} name={q.channelName} size="md" /></td>
                      <td className="small q-err" colSpan={portal ? 3 : costTable || re ? 4 : 6} style={{ color: "var(--err)" }}>
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
