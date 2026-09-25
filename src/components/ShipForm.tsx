"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createAction, quoteAction } from "@/app/actions";
import { portalCreateAction, portalQuoteAction } from "@/app/portal/actions";
import type { PublicQuote } from "@/lib/portal";
import AddressFields from "@/components/AddressFields";
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

const UNIT_LABEL: Record<UnitSystem, [string, string]> = { 1: ["g", "cm"], 2: ["kg", "cm"], 3: ["lb", "in"] };

/** 报价行：后台看到完整信息（成本、利润），客户端只有价格 */
type Quote = PublicQuote & Partial<Pick<ChannelQuote, "cost" | "listCost" | "rule" | "profit">>;

export default function ShipForm(props: {
  /** portal = 客户自助下单：不选客户、只显示客户价 */
  mode?: "admin" | "portal";
  customers?: { id: number; name: string; balance?: number; available?: number; sender?: Address | null; channelCount?: number }[];
  defaultCustomerId?: number;
  defaultSender: Address | null;
  defaultUnit: UnitSystem;
  defaultCurrency: string;
}) {
  const router = useRouter();
  const portal = props.mode === "portal";
  const customers = props.customers ?? [];
  const [customerId, setCustomerId] = useState<number>(props.defaultCustomerId ?? customers[0]?.id ?? 0);
  const [customerRef, setCustomerRef] = useState("");
  const initialCustomer = customers.find((c) => c.id === (props.defaultCustomerId ?? customers[0]?.id));
  const [sender, setSender] = useState<Partial<Address>>(initialCustomer?.sender ?? props.defaultSender ?? {});
  const [editSender, setEditSender] = useState(!props.defaultSender);
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
      const r = portal ? await portalQuoteAction(buildRequest()) : await quoteAction(customerId, buildRequest());
      setErrors(r.errors ?? []);
      setQuotes(r.quotes ?? null);
    });
  }

  async function onCreate(q: Quote) {
    const customer = customers.find((c) => c.id === customerId)?.name;
    const msg = portal
      ? `确认用 ${q.channelName} 出单？\n运费：${money(q.price, q.currency)}（从账户余额扣除）`
      : `确认用 ${q.channelName} 出单？\n客户：${customer}\n客户价：${money(q.price, q.currency)}（从客户余额扣除）`;
    if (!window.confirm(msg)) return;
    setCreating(q.channelCode);
    setErrors([]);
    try {
      const r = portal
        ? await portalCreateAction({ channelCode: q.channelCode, req: buildRequest(), expectedPrice: q.price!, remark, customerRef })
        : await createAction({ customerId, channelCode: q.channelCode, req: buildRequest(), expectedPrice: q.price!, remark, customerRef });
      if (r.id) {
        router.push(portal ? `/portal/shipments/${r.id}` : `/shipments/${r.id}`);
        return;
      }
      if (r.quote) {
        // 价格变了：更新这一行，让员工重新确认
        setQuotes((qs) => qs?.map((x) => (x.channelCode === r.quote!.channelCode ? r.quote! : x)) ?? null);
        setNotice(r.error ?? null);
      } else {
        setErrors([r.error ?? "出单失败"]);
      }
    } finally {
      setCreating(null);
    }
  }

  const setSku = (i: number, patch: Partial<Sku>) => dirty(setSkus)(skus.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const bestPrice = quotes?.filter((q) => q.ok).map((q) => q.price!)[0];

  return (
    <>
      <div className="card">
        <div className="row">
          {!portal && (
            <label className="f" style={{ minWidth: 240 }}>
              <span className="req">客户</span>
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
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {(() => {
                const c = customers.find((x) => x.id === customerId);
                return (
                  <>
                    {c?.balance !== undefined && (
                      <span className={`small ${c.available! <= 0 ? "profit-neg" : "muted"}`}>余额 {money(c.balance)} · 可用 {money(c.available)}</span>
                    )}
                    {c?.channelCount === 0 && (
                      <span className="small" style={{ color: "var(--warn)" }}>未开通任何渠道，请先到 <a href={`/customers/${c.id}#channels`}>客户详情</a> 开通</span>
                    )}
                  </>
                );
              })()}
            </label>
          )}
          <label className="f" style={{ minWidth: 200 }}>
            {portal ? "我的订单号（可选）" : "客户订单号（可选）"}
            <input value={customerRef} maxLength={50} onChange={(e) => setCustomerRef(e.target.value)} />
          </label>
          <label className="f" style={{ flex: 1 }}>
            备注（可选）
            <input value={remark} maxLength={200} onChange={(e) => setRemark(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>寄件人</h2>
            {!editSender && <button className="small" onClick={() => setEditSender(true)}>修改</button>}
          </div>
          {editSender ? (
            <AddressFields value={sender} onChange={dirty(setSender)} />
          ) : (
            <div className="muted">
              {sender.nameFirst} {sender.nameLast} {sender.corporateName && `· ${sender.corporateName}`}<br />
              {sender.address1}, {sender.city} {sender.province} {sender.zipCode} {sender.country}
            </div>
          )}
        </div>
        <div className="card">
          <h2>收件人</h2>
          <AddressFields value={recipient} onChange={dirty(setRecipient)} />
        </div>
      </div>

      <div className="card">
        <h2>包裹</h2>
        <div className="grid">
          <label className="f">单位
            <select value={unit} onChange={(e) => dirty(setUnit)(Number(e.target.value) as UnitSystem)}>
              <option value={3}>lb / in</option>
              <option value={2}>kg / cm</option>
              <option value={1}>g / cm</option>
            </select>
          </label>
          {(["length", "width", "height"] as const).map((k) => (
            <label key={k} className="f"><span className="req">{{ length: "长", width: "宽", height: "高" }[k]}（{lu}）</span>
              <input type="number" min="0" step="0.01" value={pkg[k]} onChange={(e) => dirty(setPkg)({ ...pkg, [k]: e.target.value })} />
            </label>
          ))}
          <label className="f"><span className="req">重量（{wu}）</span>
            <input type="number" min="0" step="0.001" value={pkg.weight} onChange={(e) => dirty(setPkg)({ ...pkg, weight: e.target.value })} />
          </label>
          <label className="f">签名服务
            <select value={signType} onChange={(e) => dirty(setSignType)(Number(e.target.value))}>
              <option value={0}>不需要签名</option>
              <option value={1}>直接签名</option>
              <option value={2}>间接签名</option>
              <option value={3}>成人签名</option>
            </select>
          </label>
          <label className="f">币种<input value={currency} maxLength={3} onChange={(e) => dirty(setCurrency)(e.target.value.toUpperCase())} /></label>
          <label className="f">保险
            <select value={insurance.on ? 1 : 0} onChange={(e) => dirty(setInsurance)({ ...insurance, on: e.target.value === "1" })}>
              <option value={0}>不需要</option>
              <option value={1}>需要</option>
            </select>
          </label>
          {insurance.on && (
            <label className="f"><span className="req">保险金额</span>
              <input type="number" min="0" step="0.01" value={insurance.fee} onChange={(e) => dirty(setInsurance)({ ...insurance, fee: e.target.value })} />
            </label>
          )}
        </div>

        <h3>商品明细（报关用）</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>SKU *</th><th>中文品名 *</th><th>英文品名 *</th><th>数量 *</th><th>申报单价 *</th><th>海关编码</th><th>商品性质 *</th><th></th></tr>
            </thead>
            <tbody>
              {skus.map((s, i) => (
                <tr key={i}>
                  <td><input value={s.sku} onChange={(e) => setSku(i, { sku: e.target.value })} /></td>
                  <td><input value={s.productNameCn} onChange={(e) => setSku(i, { productNameCn: e.target.value })} /></td>
                  <td><input value={s.productNameEn} onChange={(e) => setSku(i, { productNameEn: e.target.value })} /></td>
                  <td style={{ width: 80 }}><input type="number" min="1" value={s.quantity} onChange={(e) => setSku(i, { quantity: e.target.value })} /></td>
                  <td style={{ width: 110 }}><input type="number" min="0" step="0.01" value={s.declaredUnitPrice} onChange={(e) => setSku(i, { declaredUnitPrice: e.target.value })} /></td>
                  <td style={{ width: 130 }}><input value={s.hsCode} onChange={(e) => setSku(i, { hsCode: e.target.value })} /></td>
                  <td style={{ minWidth: 200 }} className="small">
                    {NATURE.map(([code, label]) => {
                      const set = new Set(s.productNature.split(",").filter(Boolean));
                      return (
                        <label key={code} style={{ marginRight: 8, whiteSpace: "nowrap" }}>
                          <input
                            type="checkbox"
                            checked={set.has(code)}
                            onChange={(e) => {
                              e.target.checked ? set.add(code) : set.delete(code);
                              setSku(i, { productNature: [...set].sort().join(",") });
                            }}
                          /> {label}
                        </label>
                      );
                    })}
                  </td>
                  <td>{skus.length > 1 && <button className="small danger" onClick={() => dirty(setSkus)(skus.filter((_, j) => j !== i))}>删除</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="small" style={{ marginTop: 8 }} onClick={() => dirty(setSkus)([...skus, emptySku()])}>＋ 添加商品</button>
      </div>

      {errors.length > 0 && (
        <div className="alert err"><ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: quotes ? 12 : 0 }}>
          <h2 style={{ margin: 0 }}>报价</h2>
          <button className="primary" onClick={onQuote} disabled={quoting || (!portal && !customerId)}>
            {quoting ? "试算中…" : quotes ? "重新试算" : "试算所有渠道"}
          </button>
        </div>
        {notice && <div className="alert warn">{notice}</div>}
        {quotes && (
          <div className="row small" style={{ justifyContent: "space-between", marginBottom: 8, alignItems: "center" }}>
            <span className="muted">
              {quotes.filter((q) => q.ok).length} 个渠道可以送达
              {quotes.some((q) => !q.ok) && `，${quotes.filter((q) => !q.ok).length} 个渠道不支持这个地址`}
            </span>
            <label><input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} /> 只显示可下单渠道</label>
          </div>
        )}
        {quotes && !quotes.some((q) => q.ok) && <div className="alert err">所有渠道都不支持这个地址或包裹，请检查邮编、地址或重量尺寸。</div>}
        {quotes && (
          <div className="table-wrap">
            <table>
              <thead>
                {portal ? (
                  <tr><th>渠道</th><th>分区</th><th className="num">运费</th><th></th></tr>
                ) : (
                  <tr><th>渠道</th><th>分区</th><th className="num">原价</th><th className="num">我们的成本</th><th>加价规则</th><th className="num">客户价</th><th className="num">利润</th><th></th></tr>
                )}
              </thead>
              <tbody>
                {quotes.filter((q) => q.ok || !onlyAvailable).map((q) =>
                  q.ok ? (
                    <tr key={q.channelCode} className={q.price === bestPrice ? "best" : ""}>
                      <td>{q.channelName}{!portal && <div className="small muted">{q.channelCode}</div>}</td>
                      <td>{q.zone ?? "-"}</td>
                      {!portal && (
                        <>
                          <td className="num muted">{money(q.listCost)}</td>
                          <td className="num">{money(q.cost, q.currency)}</td>
                          <td className="small">+{q.rule!.percent}% + {q.rule!.fixed}，最低利润 {q.rule!.minProfit}</td>
                        </>
                      )}
                      <td className="num"><b>{money(q.price, q.currency)}</b></td>
                      {!portal && <td className="num profit-pos">{money(q.profit)}</td>}
                      <td>
                        <button className="primary small" disabled={!!creating} onClick={() => onCreate(q)}>
                          {creating === q.channelCode ? "出单中…" : "用此渠道出单"}
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={q.channelCode}>
                      <td>{q.channelName}</td>
                      <td colSpan={portal ? 3 : 7} className="small" style={{ color: "var(--err)" }}>{q.error}</td>
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
