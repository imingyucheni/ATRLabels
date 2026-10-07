"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Plus, Trash2, CheckCircle2, XCircle } from "lucide-react";
import AddressFields from "@/components/AddressFields";
import ChannelLabel from "@/components/ChannelLabel";
import { useT, useTMsg } from "@/components/I18n";
import { money } from "@/lib/pricing";
import { DEFAULT_ITEM_SKU } from "@/lib/sanitize";
import { checkMultiBox, expandPieces, multiBoxRule, summarizePieces, type MultiBoxRule, type Piece } from "@/lib/multiBox";
import { multiCreateAction, multiQuoteAction, type MultiQuote } from "@/app/multiActions";
import type { Address, ShipmentRequest } from "@/lib/shipbest/types";

type Line = { length: string; width: string; height: string; weight: string; qty: string };
const EMPTY_LINE: Line = { length: "", width: "", height: "", weight: "", qty: "" };

export interface MultiCustomer {
  id: number;
  name: string;
  sender: Address | null;
  /** 这个客户开通的多箱渠道（内部名称，用来判断适用哪些规则） */
  channels: string[];
}

/**
 * 多箱寄出：一个寄件地址、一个收件地址，按箱规填（长宽高、单箱重量、几箱），
 * 一票按总重量计价（UPS HWT / FedEx MWT）。填的时候实时显示总箱数、总重量、计费重和渠道要求是否满足。
 */
export default function MultiBoxForm(props: {
  mode: "admin" | "portal";
  /** 后台：选客户 */
  customers?: MultiCustomer[];
  /** 客户 OMS：自己开通的多箱渠道 */
  channels?: string[];
  defaultSender: Address | null;
  senders?: { id: number; label: string; address: Address; isDefault: boolean }[];
  showCost?: boolean;
}) {
  const t = useT();
  const tm = useTMsg();
  const router = useRouter();
  const [customerId, setCustomerId] = useState<number | undefined>(props.customers?.[0]?.id);
  const customer = props.customers?.find((c) => c.id === customerId);
  const firstSender = props.senders?.find((s) => s.isDefault)?.address ?? props.senders?.[0]?.address ?? customer?.sender ?? props.defaultSender;
  const [sender, setSender] = useState<Partial<Address>>(firstSender ?? { country: "US" });
  const [recipient, setRecipient] = useState<Partial<Address>>({ country: "US" });
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
  const [item, setItem] = useState({ name: "", hs: "", value: "", sku: "" });
  const [ref, setRef] = useState("");
  const [quotes, setQuotes] = useState<MultiQuote[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, start] = useTransition();

  const channelNames = props.mode === "admin" ? customer?.channels ?? [] : props.channels ?? [];
  const rules = useMemo(() => {
    const out: MultiBoxRule[] = [];
    for (const n of channelNames) {
      const r = multiBoxRule(n);
      if (r && !out.includes(r)) out.push(r);
    }
    return out;
  }, [channelNames]);

  const pieces: Piece[] = lines
    .map((l) => ({ length: Number(l.length), width: Number(l.width), height: Number(l.height), weight: Number(l.weight), qty: Math.floor(Number(l.qty)) }))
    .filter((p) => p.length > 0 || p.width > 0 || p.height > 0 || p.weight > 0 || p.qty > 0);
  const filled = pieces.filter((p) => p.length > 0 && p.width > 0 && p.height > 0 && p.weight > 0 && p.qty > 0);
  const rule0 = rules[0] ?? null;
  const sum = summarizePieces(filled, rule0);
  const items = [{ productNameEn: item.name, hsCode: item.hs }];

  const dirty = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setQuotes(null);
    setPicked(null);
  };
  const setLine = (i: number, k: keyof Line, v: string) => dirty(setLines)(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const buildReq = (): ShipmentRequest => ({
    sender: sender as Address,
    recipient: recipient as Address,
    pkg: { length: 0, width: 0, height: 0, weight: 0, displayUnitSystem: 3, signServiceType: 0, insuranceService: 0, currency: "USD", pieces: filled },
    skuList: [
      {
        sku: item.sku.trim() || DEFAULT_ITEM_SKU,
        productNameCn: "",
        productNameEn: item.name.trim(),
        quantity: 1,
        declaredUnitPrice: Number(item.value) || 0,
        declaredCurrency: "USD",
        hsCode: item.hs.trim(),
        productNature: "2,4",
        length: 0, width: 0, height: 0, weight: 0, unit: 3,
      },
    ],
  });

  const quote = () => {
    setErrors([]);
    start(async () => {
      const r = await multiQuoteAction({ customerId, req: buildReq() });
      if (r.errors) {
        setErrors(r.errors);
        setQuotes(null);
        return;
      }
      setQuotes(r.quotes ?? []);
      setPicked(r.quotes?.find((q) => q.ok)?.channelCode ?? null);
    });
  };

  const submit = () => {
    const q = quotes?.find((x) => x.channelCode === picked);
    if (!q?.ok || q.price === undefined) return;
    if (!window.confirm(t("确认下单？{boxes} 箱，运费 {price}。下单后从账户余额扣除。", { boxes: sum.boxes, price: money(q.price, q.currency) }))) return;
    setErrors([]);
    start(async () => {
      const r = await multiCreateAction({ customerId, channelCode: q.channelCode, req: buildReq(), expectedPrice: q.price!, customerRef: ref });
      if (r.error) {
        setErrors([r.error]);
        if (r.newPrice !== undefined) setQuotes((list) => list?.map((x) => (x.channelCode === q.channelCode ? { ...x, price: r.newPrice } : x)) ?? null);
        return;
      }
      router.push(props.mode === "portal" ? `/portal/shipments/${r.id}` : `/shipments/${r.id}`);
    });
  };

  const noChannel = !channelNames.length;

  return (
    <div className="multi-box">
      {props.mode === "admin" && (
        <div className="card">
          <label className="f" style={{ maxWidth: 360 }}>
            <span className="req">{t("客户")}</span>
            <select
              value={customerId ?? ""}
              onChange={(e) => {
                const id = Number(e.target.value);
                setCustomerId(id);
                const c = props.customers?.find((x) => x.id === id);
                if (c?.sender) setSender(c.sender);
                setQuotes(null);
              }}
            >
              {props.customers?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.channels.length ? "" : ` ${t("（未开通多箱渠道）")}`}</option>)}
            </select>
          </label>
        </div>
      )}

      {noChannel && (
        <div className="alert warn">{props.mode === "admin" ? t("这个客户还没有开通多箱渠道（UPS HWT / FedEx MWT），请到客户详情 → 渠道与价格里开通。") : t("您的账户还没有开通多箱渠道（UPS HWT / FedEx MWT），请联系客服开通。")}</div>
      )}

      {rules.map((r) => (
        <details key={r.id} className="card mb-rules" open>
          <summary><b>{r.label}</b> {t("下单要求")}</summary>
          <ul className="small">{r.notes.map((n) => <li key={n}>{t(n)}</li>)}</ul>
        </details>
      ))}

      <div className="grid-2">
        <div className="card">
          <h2>{t("寄件人")}</h2>
          {!!props.senders?.length && (
            <label className="f" style={{ marginBottom: 8 }}>
              {t("地址簿")}
              <select defaultValue="" onChange={(e) => { const s = props.senders?.find((x) => x.id === Number(e.target.value)); if (s) dirty(setSender)(s.address); }}>
                <option value="">{t("选择保存的寄件地址…")}</option>
                {props.senders.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
          )}
          <AddressFields value={sender} onChange={dirty(setSender)} />
        </div>
        <div className="card">
          <h2>{t("收件人")}</h2>
          <AddressFields value={recipient} onChange={dirty(setRecipient)} />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2><Boxes size={18} aria-hidden="true" /> {t("箱规")}</h2>
          <span className="small muted">{t("同样尺寸和重量的箱子填一行，写上箱数。尺寸英寸（in），重量磅（lb）。")}</span>
        </div>
        <div className="table-wrap">
          <table className="list mb-lines">
            <thead>
              <tr><th>#</th><th>{t("长 (in)")}</th><th>{t("宽 (in)")}</th><th>{t("高 (in)")}</th><th>{t("单箱重量 (lb)")}</th><th>{t("箱数")}</th><th className="num mb-sub">{t("小计重量")}</th><th></th></tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const p = { length: Number(l.length), width: Number(l.width), height: Number(l.height), weight: Number(l.weight), qty: Number(l.qty) };
                const sub = p.weight > 0 && p.qty > 0 ? Math.round(p.weight * p.qty * 100) / 100 : null;
                return (
                  <tr key={i}>
                    <td className="muted">{String.fromCharCode(65 + (i % 26))}</td>
                    {(["length", "width", "height", "weight", "qty"] as const).map((k) => (
                      <td key={k}>
                        <input type="number" min={0} step={k === "qty" ? 1 : 0.1} inputMode="decimal" value={l[k]} onChange={(e) => setLine(i, k, e.target.value)} aria-label={`${String.fromCharCode(65 + (i % 26))} ${k}`} />
                      </td>
                    ))}
                    <td className="num mb-sub">{sub !== null ? `${sub} lb` : "-"}</td>
                    <td>{lines.length > 1 && <button type="button" className="link-btn" aria-label={t("删除")} onClick={() => dirty(setLines)(lines.filter((_, j) => j !== i))}><Trash2 size={15} /></button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" className="small" onClick={() => dirty(setLines)([...lines, { ...EMPTY_LINE }])} disabled={lines.length >= 50}><Plus size={14} /> {t("添加箱规")}</button>

        <div className="stats mb-sum">
          <div className="stat"><div className="muted">{t("总箱数")}</div><div className="v">{sum.boxes}</div></div>
          <div className="stat"><div className="muted">{t("总实重")}</div><div className="v">{sum.actual} lb</div></div>
          <div className="stat"><div className="muted">{t("体积重")}{rule0 ? ` (÷${rule0.dimDivisor})` : ""}</div><div className="v">{sum.dim} lb</div></div>
          <div className="stat"><div className="muted">{t("预计计费重")}</div><div className="v">{sum.billable} lb</div></div>
        </div>

        {rules.map((r) => {
          const errs = filled.length ? checkMultiBox(r, filled, items, { forOrder: true }) : [];
          return (
            <div key={r.id} className={`alert ${!filled.length ? "info" : errs.length ? "warn" : "ok"} small`}>
              {!filled.length ? (
                <>{t("填好箱规后，这里会检查是否符合 {label} 的要求", { label: r.label })}</>
              ) : errs.length ? (
                <>
                  <b><XCircle size={14} aria-hidden="true" /> {t("{label}：还有 {n} 项不符合", { label: r.label, n: errs.length })}</b>
                  <ul>{errs.map((e) => <li key={e}>{tm(e)}</li>)}</ul>
                </>
              ) : (
                <b><CheckCircle2 size={14} aria-hidden="true" /> {t("{label}：{boxes} 箱 · {lb} lb，符合要求", { label: r.label, boxes: expandPieces(filled).length, lb: sum.actual })}</b>
              )}
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2>{t("货物信息")}</h2>
        <div className="grid">
          <label className="f"><span className="req">{t("英文品名")}</span><input value={item.name} maxLength={50} placeholder={t("例如 Cotton T-shirts")} onChange={(e) => dirty(setItem)({ ...item, name: e.target.value })} /><span className="field-hint muted">{t("不能有中文，建议写清楚是什么货")}</span></label>
          <label className="f"><span className={rules.some((r) => r.hsMinDigits) ? "req" : ""}>{t("海关编码（HS）")}</span><input value={item.hs} maxLength={14} inputMode="numeric" placeholder="61091000" onChange={(e) => dirty(setItem)({ ...item, hs: e.target.value })} /><span className="field-hint muted">{t("至少 8 位数字")}</span></label>
          <label className="f"><span className="req">{t("整票申报价值（USD）")}</span><input type="number" min={0} step={0.01} value={item.value} onChange={(e) => dirty(setItem)({ ...item, value: e.target.value })} /></label>
          <label className="f">{t("SKU（可选）")}<input value={item.sku} maxLength={64} onChange={(e) => dirty(setItem)({ ...item, sku: e.target.value })} /></label>
          <label className="f">{t("自定义单号（可选）")}<input value={ref} maxLength={50} onChange={(e) => setRef(e.target.value)} /></label>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>{t("报价")}</h2>
          <button type="button" className="primary" disabled={busy || noChannel || !filled.length} onClick={quote}>{busy && !quotes ? t("查询中…") : quotes ? t("重新查询运费") : t("查询运费")}</button>
        </div>
        {errors.length > 0 && <div className="alert err">{errors.map((e) => <div key={e}>{e}</div>)}</div>}
        {quotes && (
          quotes.length ? (
            <>
              <div className="table-wrap">
                <table className="list card-table mb-quotes">
                  <thead><tr><th></th><th>{t("渠道")}</th><th>{t("分区")}</th>{props.showCost && <th className="num">{t("我们的成本")}</th>}<th className="num">{t("运费")}</th></tr></thead>
                  <tbody>
                    {quotes.map((q) => (
                      <tr key={q.channelCode} style={{ opacity: q.ok ? 1 : 0.65 }}>
                        <td className="c-check"><input type="radio" name="mb-ch" disabled={!q.ok} checked={picked === q.channelCode} onChange={() => setPicked(q.channelCode)} /></td>
                        <td className="c-main"><ChannelLabel code={q.channelCode} name={q.channelName} size="md" />{!q.ok && <div className="small warn-text">{q.error}</div>}</td>
                        <td data-label={t("分区")}>{q.zone ?? "-"}</td>
                        {props.showCost && <td className="num muted" data-label={t("我们的成本")}>{q.cost !== undefined ? money(q.cost) : "-"}</td>}
                        <td className="num" data-label={t("运费")}><b>{q.ok ? money(q.price, q.currency) : t("不可用")}</b>{q.ok && sum.billable > 0 && q.price !== undefined && <div className="small muted">{t("约 {p}/lb", { p: (q.price / sum.billable).toFixed(2) })}</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small muted">{t("运费不含住宅地址、偏远地区等附加费，以承运商实际账单为准（多退少补）。")}</p>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="primary" disabled={busy || !quotes.some((q) => q.ok && q.channelCode === picked)} onClick={submit}>{busy ? t("处理中…") : t("确认下单（{n} 箱）", { n: sum.boxes })}</button>
              </div>
            </>
          ) : (
            <div className="alert warn">{t("没有可用的多箱渠道")}</div>
          )
        )}
      </div>
    </div>
  );
}
