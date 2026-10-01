"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { importStoreOrdersAction } from "@/app/portal/actions";
import { useT } from "@/components/I18n";
import PlatformLogo from "@/components/PlatformLogo";

type Unit = 1 | 2 | 3;
type Pkg = { length: number; width: number; height: number; weight: number; unit: Unit };

export interface StoreOrderView {
  id: number;
  platform: "shopify" | "ebay";
  storeName: string;
  name: string;
  orderedAt: string | null;
  recipient: string;
  items: string;
  weightGrams: number;
  status: "open" | "imported" | "shipped" | "closed";
  jobId: number | null;
  shipmentId: number | null;
  trackingNo: string | null;
  pushError: string | null;
  /** 收件信息不全，不能导入 */
  issue?: "no_address" | "hidden";
  /** 以前发过同样商品组合时用的包裹（自动带出） */
  suggest?: Pkg | null;
  /** 买家选的配送方式 / 留言 */
  shippingMethod?: string | null;
  note?: string | null;
  /** 面单已经出好（有运单号），等后台回传店铺 */
  labelReady?: boolean;
}

type Dims = { length: string; width: string; height: string; weight: string };
const KEYS = ["length", "width", "height", "weight"] as const;
const EMPTY: Dims = { length: "", width: "", height: "", weight: "" };

const STATUS: Record<StoreOrderView["status"], [string, string]> = {
  open: ["待处理", "pending"],
  imported: ["已导入待出单", ""],
  shipped: ["已发货 · 已回传", "labeled"],
  closed: ["已关闭", ""],
};

const units = (u: Unit) => (u === 3 ? ["in", "lb"] : u === 2 ? ["cm", "kg"] : ["cm", "g"]);
const round = (n: number, d = 2) => String(Math.round(n * 10 ** d) / 10 ** d);

/** 换单位：长度 in ↔ cm，重量 lb / kg / g */
function convert(d: Dims, from: Unit, to: Unit): Dims {
  if (from === to) return d;
  const len = (s: string) => (s === "" ? "" : round(Number(s) * (from === 3 ? 2.54 : 1) / (to === 3 ? 2.54 : 1), 1));
  const grams = (n: number, u: Unit) => (u === 3 ? n * 453.59237 : u === 2 ? n * 1000 : n);
  const w = d.weight === "" ? "" : (() => {
    const g = grams(Number(d.weight), from);
    return to === 3 ? round(g / 453.59237) : to === 2 ? round(g / 1000, 3) : round(g, 0);
  })();
  return { length: len(d.length), width: len(d.width), height: len(d.height), weight: w };
}

/** 每个订单一开始的尺寸：以前发过同样的商品就用上次的包裹，否则只带出订单重量 */
function initial(r: StoreOrderView, unit: Unit): { d: Dims; fromHistory: boolean } {
  if (r.suggest) {
    const s = r.suggest;
    return { d: convert({ length: String(s.length), width: String(s.width), height: String(s.height), weight: String(s.weight) }, s.unit, unit), fromHistory: true };
  }
  if (r.weightGrams > 0) return { d: convert({ ...EMPTY, weight: round(r.weightGrams, 0) }, 1, unit), fromHistory: false };
  return { d: { ...EMPTY }, fromHistory: false };
}

/** 店铺订单列表：每个订单填自己的包裹尺寸和重量（上面可以一键批量填），勾选后导入批量下单 */
export default function StoreOrders({ rows, presets, senders, defaultUnit = 3 }: {
  rows: StoreOrderView[];
  presets: { length: number; width: number; height: number; weight: number; unit: number }[];
  senders: { id: number; label: string; isDefault: boolean }[];
  defaultUnit?: Unit;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [unit, setUnit] = useState<Unit>(defaultUnit);
  const open = rows.filter((r) => r.status === "open" && !r.issue);
  const blocked = rows.filter((r) => r.status === "open" && r.issue).length;
  const [dims, setDims] = useState<Record<number, Dims>>(() => Object.fromEntries(open.map((r) => [r.id, initial(r, defaultUnit).d])));
  const remembered = new Set(open.filter((r) => r.suggest).map((r) => r.id));
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [bulk, setBulk] = useState<Dims>({ ...EMPTY });
  const [senderId, setSenderId] = useState<number | null>(senders.find((s) => s.isDefault)?.id ?? senders[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [q, setQ] = useState("");
  // 搜索：订单号、收件人、商品 / SKU
  const kw = q.trim().toLowerCase();
  const shown = kw ? rows.filter((r) => `${r.name} ${r.recipient} ${r.items}`.toLowerCase().includes(kw)) : rows;
  const [lu, wu] = units(unit);

  const all = open.length > 0 && open.every((r) => sel.has(r.id));
  const complete = (d?: Dims) => !!d && KEYS.every((k) => Number(d[k]) > 0);
  const missing = [...sel].filter((id) => !complete(dims[id]));
  const toggle = (id: number) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  function changeUnit(u: Unit) {
    setDims((m) => Object.fromEntries(Object.entries(m).map(([id, d]) => [id, convert(d, unit, u)])));
    setBulk((b) => convert(b, unit, u));
    setUnit(u);
  }

  /** 把上面填的尺寸 / 重量填到勾选的订单（没填的项不动） */
  function applyBulk(target: "selected" | "empty") {
    const ids = target === "selected" ? [...sel] : open.filter((r) => !complete(dims[r.id])).map((r) => r.id);
    setDims((m) => {
      const n = { ...m };
      for (const id of ids) {
        const cur = n[id] ?? { ...EMPTY };
        n[id] = { ...cur, ...Object.fromEntries(KEYS.filter((k) => bulk[k] !== "" && (target === "selected" || cur[k] === "")).map((k) => [k, bulk[k]])) };
      }
      return n;
    });
  }

  function onImport() {
    setError(null);
    if (missing.length) {
      setShowMissing(true);
      return setError(t("有 {n} 个勾选的订单没填完尺寸或重量（已标红）", { n: missing.length }));
    }
    start(async () => {
      const r = await importStoreOrdersAction({
        senderId,
        orders: [...sel].map((id) => ({ id, pkg: { length: Number(dims[id].length), width: Number(dims[id].width), height: Number(dims[id].height), weight: Number(dims[id].weight), unit } })),
      });
      if (r.error) return setError(r.error);
      router.push(`/portal/batch?job=${r.jobId}`);
    });
  }

  const bulkReady = KEYS.some((k) => bulk[k] !== "");

  return (
    <>
      {(open.length > 0 || blocked > 0) && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{t("导入到批量下单")}</h2>
          <div className="grid" style={{ marginBottom: 12 }}>
            <label className="f">{t("寄件地址")}
              {senders.length ? (
                <select value={senderId ?? ""} onChange={(e) => setSenderId(Number(e.target.value) || null)}>
                  {senders.map((s) => <option key={s.id} value={s.id}>{s.label}{s.isDefault ? ` ${t("（默认）")}` : ""}</option>)}
                </select>
              ) : (
                <span className="small" style={{ color: "var(--warn)" }}>
                  {t("还没有寄件地址，")}<a href="/portal/account#senders">{t("去账户设置添加")}</a>
                </span>
              )}
            </label>
            <label className="f">{t("单位")}
              <select value={unit} onChange={(e) => changeUnit(Number(e.target.value) as Unit)}>
                <option value={3}>lb / in</option>
                <option value={2}>kg / cm</option>
                <option value={1}>g / cm</option>
              </select>
            </label>
          </div>

          <div className="bulk-pkg">
            <span className="small"><b>{t("批量填写")}</b></span>
            {KEYS.map((k) => (
              <label key={k} className="dim-in">
                <span>{t({ length: "长", width: "宽", height: "高", weight: "重" }[k])}</span>
                <input type="number" min="0" step="0.01" inputMode="decimal" value={bulk[k]} onChange={(e) => setBulk({ ...bulk, [k]: e.target.value })} />
                <i>{k === "weight" ? wu : lu}</i>
              </label>
            ))}
            <button type="button" className="small primary" disabled={!bulkReady || !sel.size} onClick={() => applyBulk("selected")}>{t("填到勾选的 {n} 单", { n: sel.size })}</button>
            <button type="button" className="small" disabled={!bulkReady} onClick={() => applyBulk("empty")}>{t("只填没填的")}</button>
          </div>
          {presets.length > 0 && (
            <div className="pkg-presets" style={{ margin: "8px 0 0" }}>
              <span className="small muted">{t("常用尺寸")}</span>
              {presets.map((p, i) => {
                const [a, b] = units(p.unit as Unit);
                return (
                  <button key={i} type="button" className="chip" onClick={() => setBulk(convert({ length: String(p.length), width: String(p.width), height: String(p.height), weight: String(p.weight) }, p.unit as Unit, unit))}>
                    {p.length}×{p.width}×{p.height} {a} · {p.weight} {b}
                  </button>
                );
              })}
            </div>
          )}
          <p className="small muted" style={{ margin: "8px 0 0" }}>
            {t("每个订单在下面的表格里填自己的尺寸和重量；以前发过同样商品的订单会自动带出上次的包裹。")}
          </p>

          {error && <div className="alert err" style={{ marginTop: 12 }}>{t(error)}</div>}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" disabled={busy || !sel.size || !senders.length} onClick={onImport}>{busy ? t("导入中…") : t("导入到批量下单（{n} 单）", { n: sel.size })}</button>
            <span className="small muted">{t("已勾选 {n} / {m} 个待处理订单", { n: sel.size, m: open.length })}</span>
            {!senders.length && (
              <span className="small" style={{ color: "var(--err)" }}>
                {t("要先添加寄件地址才能导入：")}<a href="/portal/account#senders">{t("去账户设置 → 寄件地址簿")}</a>
              </span>
            )}
            {blocked > 0 && <span className="small" style={{ color: "var(--warn)" }}>{t("另有 {n} 单收件信息不全，补全后再同步就能导入", { n: blocked })}</span>}
          </div>
        </div>
      )}

      <div className="card table-wrap">
        {rows.length > 5 && (
          <div className="row" style={{ marginBottom: 10 }}>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("搜索订单号、收件人、商品 / SKU")} style={{ maxWidth: 320 }} />
            {kw && <span className="small muted">{t("找到 {n} 单", { n: shown.length })}</span>}
          </div>
        )}
        <table className="list">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                {open.length > 0 && <input type="checkbox" aria-label={t("全选")} checked={all} onChange={() => setSel(all ? new Set() : new Set((kw ? shown.filter((r) => r.status === "open" && !r.issue) : open).map((r) => r.id)))} />}
              </th>
              <th>{t("店铺订单号")}</th><th>{t("收件人")}</th><th>{t("商品")}</th>
              <th>{t("包裹（长×宽×高 {l} · 重量 {w}）", { l: lu, w: wu })}</th><th>{t("状态")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const editable = r.status === "open" && !r.issue;
              const d = dims[r.id] ?? EMPTY;
              const red = showMissing && sel.has(r.id) && !complete(d);
              return (
                <tr key={r.id} className={sel.has(r.id) ? "on" : ""}>
                  <td>{editable && <input type="checkbox" aria-label={t("选择")} checked={sel.has(r.id)} onChange={() => toggle(r.id)} />}</td>
                  <td>
                    <b>{r.name}</b>
                    <div className="small muted">{r.orderedAt ? r.orderedAt.slice(0, 16).replace("T", " ") : ""}</div>
                    <div className="small muted row" style={{ gap: 6, marginTop: 4 }}><PlatformLogo platform={r.platform} size="sm" />{r.storeName}</div>
                  </td>
                  <td className="small wrap">
                    {r.issue === "no_address" ? <span className="muted">—</span> : r.recipient}
                    {r.issue && (
                      <div style={{ color: "var(--warn)" }}>
                        {r.issue === "no_address" ? t("缺收件地址：请在店铺订单里补上收货地址") : t("缺收件人姓名 / 街道地址：请在店铺订单里补全")}
                      </div>
                    )}
                  </td>
                  <td className="small wrap">
                    {r.items}
                    {r.shippingMethod && <div><span className="badge">{t("买家选：{m}", { m: r.shippingMethod })}</span></div>}
                    {r.note && <div className="muted" title={r.note}>{t("留言：")}{r.note.length > 60 ? `${r.note.slice(0, 60)}…` : r.note}</div>}
                  </td>
                  <td>
                    {editable ? (
                      <div className={`row-dims${red ? " missing" : ""}`}>
                        {KEYS.map((k, i) => (
                          <span key={k} className="row-dim">
                            {i === 3 && <b className="sep">·</b>}
                            {i > 0 && i < 3 && <b className="sep">×</b>}
                            <input
                              type="number" min="0" step="0.01" inputMode="decimal" aria-label={t({ length: "长", width: "宽", height: "高", weight: "重量" }[k])}
                              placeholder={t({ length: "长", width: "宽", height: "高", weight: "重" }[k])}
                              value={d[k]}
                              onChange={(e) => setDims((m) => ({ ...m, [r.id]: { ...d, [k]: e.target.value } }))}
                              onFocus={() => !sel.has(r.id) && toggle(r.id)}
                            />
                          </span>
                        ))}
                        {remembered.has(r.id) && <div className="small muted">{t("按上次同款商品带出")}</div>}
                      </div>
                    ) : (
                      <span className="small muted">-</span>
                    )}
                  </td>
                  <td className="small">
                    {r.status === "imported" && r.labelReady
                      ? <span className="badge labeled">{t("已出单 · 回传中")}</span>
                      : <span className={`badge ${STATUS[r.status][1]}`}>{t(STATUS[r.status][0])}</span>}
                    {r.trackingNo && <div>{r.shipmentId ? <a href={`/portal/shipments/${r.shipmentId}`}>{r.trackingNo}</a> : r.trackingNo}</div>}
                    {r.status === "imported" && r.jobId && !r.labelReady && <div><a href={`/portal/batch?job=${r.jobId}`}>{t("去出单 →")}</a></div>}
                    {r.pushError && <div style={{ color: "var(--warn)", maxWidth: 240 }}>{t("回传店铺失败，稍后自动重试")}{t("：")}{r.pushError}</div>}
                  </td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={6} className="muted">{kw ? t("没有找到匹配的订单") : t("没有订单")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
