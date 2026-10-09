"use client";

import { useState, useTransition } from "react";
import { Package, Plus, Search } from "lucide-react";
import { useT, useTMsg } from "@/components/I18n";
import { deleteProductAction, saveProductAction } from "@/app/productActions";
import type { SavedProduct } from "@/lib/products";
import { DIM_UNITS, WEIGHT_UNITS, type DimUnit, type WeightUnit } from "@/lib/units";

type Draft = Record<"name" | "sku" | "productNameEn" | "productNameCn" | "declaredUnitPrice" | "hsCode" | "material" | "originCountry" | "quantity" | "length" | "width" | "height" | "weight", string> & {
  id?: number;
  productNature: string;
  dimUnit: DimUnit;
  weightUnit: WeightUnit;
};

const txt = (n: number) => (n ? String(n) : "");
const toDraft = (p: Omit<SavedProduct, "id"> & { id?: number }): Draft => ({
  id: p.id,
  name: p.name === [p.sku, p.productNameEn || p.productNameCn].filter(Boolean).join(" · ") ? "" : p.name,
  sku: p.sku, productNameEn: p.productNameEn, productNameCn: p.productNameCn, declaredUnitPrice: txt(p.declaredUnitPrice), hsCode: p.hsCode,
  material: p.material, originCountry: p.originCountry, quantity: String(p.quantity || 1), productNature: p.productNature || "2,4",
  length: txt(p.length), width: txt(p.width), height: txt(p.height), weight: txt(p.weight), dimUnit: p.dimUnit, weightUnit: p.weightUnit,
});
const blank = (dimUnit: DimUnit, weightUnit: WeightUnit): Draft => ({
  name: "", sku: "", productNameEn: "", productNameCn: "", declaredUnitPrice: "", hsCode: "", material: "", originCountry: "", quantity: "1", productNature: "2,4",
  length: "", width: "", height: "", weight: "", dimUnit, weightUnit,
});
const toInput = (d: Draft) => ({
  ...d,
  declaredUnitPrice: Number(d.declaredUnitPrice) || 0, quantity: Number(d.quantity) || 1,
  length: Number(d.length) || 0, width: Number(d.width) || 0, height: Number(d.height) || 0, weight: Number(d.weight) || 0,
});

/**
 * 客户的常用产品：商品信息 + 一个包裹装几件 + 包裹尺寸重量。
 * 下单时选一下就把商品明细和包裹都填好；批量导入、店铺订单只填 SKU 也能带出。
 */
export default function ProductBook({ initial, suggestions, defaultDim, defaultWeight }: {
  initial: SavedProduct[];
  /** 最近订单里还没存的产品（一键添加） */
  suggestions: Omit<SavedProduct, "id">[];
  defaultDim: DimUnit;
  defaultWeight: WeightUnit;
}) {
  const t = useT();
  const tm = useTMsg();
  const [list, setList] = useState(initial);
  const [sugg, setSugg] = useState(suggestions);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, start] = useTransition();

  const kw = q.trim().toLowerCase();
  const shown = kw ? list.filter((p) => `${p.name} ${p.sku} ${p.productNameEn} ${p.productNameCn}`.toLowerCase().includes(kw)) : list;
  const set = (patch: Partial<Draft>) => edit && setEdit({ ...edit, ...patch });

  const save = (d: Draft, after?: () => void) =>
    start(async () => {
      const r = await saveProductAction(toInput(d));
      if (r.error) {
        setError(r.error);
        return;
      }
      setError(null);
      setList(r.products!);
      setMsg(t("已保存“{name}”", { name: r.products!.find((p) => p.id === r.id)?.name ?? "" }));
      after?.();
    });

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}><Package size={18} aria-hidden="true" /> {t("常用产品（{n}）", { n: list.length })}</h2>
          {!edit && <button className="primary small" onClick={() => { setEdit(blank(defaultDim, defaultWeight)); setMsg(null); }}><Plus size={14} /> {t("新增产品")}</button>}
        </div>
        <p className="small muted">
          {t("把常发的产品存起来：商品信息、一个包裹装几件、包裹的尺寸和重量。单个下单时在“包裹”上方选一下，商品明细和尺寸重量一起填好；批量导入和店铺订单只填 SKU（件数一样）也会自动带出尺寸重量。")}
        </p>
        {error && <div className="alert err">{tm(error)}</div>}
        {msg && !error && <div className="alert ok">{msg}</div>}

        {edit && (
          <div className="sender-edit product-edit">
            <div className="grid">
              <label className="f">{t("名称（可选）")}<input value={edit.name} maxLength={60} placeholder={t("例如 蓝色T恤 M码 单件")} onChange={(e) => set({ name: e.target.value })} /></label>
              <label className="f">SKU<input value={edit.sku} maxLength={64} onChange={(e) => set({ sku: e.target.value })} /><span className="field-hint muted">{t("可打印在面单上；批量导入、店铺订单按 SKU 认出产品")}</span></label>
              <label className="f">{t("英文品名")}<input value={edit.productNameEn} maxLength={100} placeholder="Cotton T-shirt" onChange={(e) => set({ productNameEn: e.target.value })} /></label>
              <label className="f">{t("中文品名（可选）")}<input value={edit.productNameCn} maxLength={100} onChange={(e) => set({ productNameCn: e.target.value })} /></label>
              <label className="f">{t("申报单价（USD，可选）")}<input type="number" min={0} step={0.01} value={edit.declaredUnitPrice} onChange={(e) => set({ declaredUnitPrice: e.target.value })} /></label>
              <label className="f"><span className="req">{t("一个包裹装几件")}</span><input type="number" min={1} step={1} value={edit.quantity} onChange={(e) => set({ quantity: e.target.value })} /></label>
            </div>
            <h3 style={{ margin: "14px 0 6px" }}>{t("包裹尺寸和重量")}</h3>
            <div className="grid pkg-grid">
              {(["length", "width", "height"] as const).map((k) => (
                <label key={k} className="f dim"><span className="req">{t({ length: "长", width: "宽", height: "高" }[k])}</span>
                  <span className="unit-input"><input type="number" min="0" step="0.01" inputMode="decimal" value={edit[k]} onChange={(e) => set({ [k]: e.target.value })} /><i>{edit.dimUnit}</i></span>
                </label>
              ))}
              <label className="f dim"><span className="req">{t("重量（含包装）")}</span>
                <span className="unit-input"><input type="number" min="0" step="0.001" inputMode="decimal" value={edit.weight} onChange={(e) => set({ weight: e.target.value })} /><i>{edit.weightUnit}</i></span>
              </label>
              <label className="f">{t("尺寸单位")}
                <select value={edit.dimUnit} onChange={(e) => set({ dimUnit: e.target.value as DimUnit })}>{DIM_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
              </label>
              <label className="f">{t("重量单位")}
                <select value={edit.weightUnit} onChange={(e) => set({ weightUnit: e.target.value as WeightUnit })}>{WEIGHT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
              </label>
            </div>
            <details style={{ marginTop: 10 }}>
              <summary className="small muted" style={{ cursor: "pointer" }}>{t("国际件报关信息（可选）")}</summary>
              <div className="grid" style={{ marginTop: 8 }}>
                <label className="f">{t("海关编码")}<input value={edit.hsCode} maxLength={14} inputMode="numeric" onChange={(e) => set({ hsCode: e.target.value })} /></label>
                <label className="f">{t("材质（英文）")}<input value={edit.material} maxLength={60} placeholder="Cotton" onChange={(e) => set({ material: e.target.value })} /></label>
                <label className="f">{t("原产国")}<input value={edit.originCountry} maxLength={2} placeholder="CN" onChange={(e) => set({ originCountry: e.target.value.toUpperCase() })} /></label>
              </div>
            </details>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="primary" disabled={busy} onClick={() => save(edit, () => setEdit(null))}>{busy ? t("保存中…") : t("保存")}</button>
              <button onClick={() => { setEdit(null); setError(null); }} disabled={busy}>{t("取消")}</button>
            </div>
          </div>
        )}

        {list.length > 8 && (
          <div className="row" style={{ maxWidth: 340, marginTop: 12, gap: 6 }}>
            <Search size={15} aria-hidden="true" className="muted" />
            <input value={q} aria-label={t("搜索")} placeholder={t("搜索名称 / SKU / 品名")} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
          </div>
        )}

        {list.length > 0 ? (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="card-table">
              <thead><tr><th>{t("产品")}</th><th>{t("品名")}</th><th className="num">{t("申报单价")}</th><th className="num">{t("每包件数")}</th><th>{t("包裹尺寸")}</th><th className="num">{t("重量")}</th><th></th></tr></thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td className="c-main"><b>{p.name}</b>{p.sku && p.name !== p.sku && !p.name.startsWith(`${p.sku} ·`) && <div className="small muted">SKU {p.sku}</div>}</td>
                    <td data-label={t("品名")}>{p.productNameEn || p.productNameCn || "-"}</td>
                    <td className="num" data-label={t("申报单价")}>{p.declaredUnitPrice ? `$${p.declaredUnitPrice}` : "-"}</td>
                    <td className="num" data-label={t("每包件数")}>{p.quantity}</td>
                    <td data-label={t("包裹尺寸")}>{p.length}×{p.width}×{p.height} {p.dimUnit}</td>
                    <td className="num" data-label={t("重量")}>{p.weight} {p.weightUnit}</td>
                    <td className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                      <button className="small" disabled={busy} onClick={() => { setEdit(toDraft(p)); setMsg(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{t("编辑")}</button>
                      <button className="small danger" disabled={busy} onClick={() => window.confirm(t("删除“{name}”？", { name: p.name })) && start(async () => setList((await deleteProductAction(p.id)).products))}>{t("删除")}</button>
                    </td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={7} className="muted">{t("没有找到")}</td></tr>}
              </tbody>
            </table>
          </div>
        ) : (
          !edit && <div className="muted small" style={{ marginTop: 12 }}>{t("还没有常用产品。点“新增产品”添加，或者从下面最近发过的产品里一键添加。")}</div>
        )}
      </div>

      {sugg.length > 0 && (
        <div className="card">
          <h2>{t("从最近的订单添加")}</h2>
          <p className="small muted" style={{ marginTop: 0 }}>{t("最近 180 天一单一个 SKU 的订单，按最近一次的商品信息和包裹。")}</p>
          <div className="table-wrap">
            <table className="card-table">
              <thead><tr><th>SKU</th><th>{t("品名")}</th><th className="num">{t("每包件数")}</th><th>{t("包裹尺寸")}</th><th className="num">{t("重量")}</th><th></th></tr></thead>
              <tbody>
                {sugg.map((p) => (
                  <tr key={p.sku}>
                    <td className="c-main"><b>{p.sku}</b></td>
                    <td data-label={t("品名")}>{p.productNameEn || p.productNameCn || "-"}</td>
                    <td className="num" data-label={t("每包件数")}>{p.quantity}</td>
                    <td data-label={t("包裹尺寸")}>{p.length}×{p.width}×{p.height} {p.dimUnit}</td>
                    <td className="num" data-label={t("重量")}>{p.weight} {p.weightUnit}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="small" disabled={busy} onClick={() => save(toDraft(p), () => setSugg((s) => s.filter((x) => x.sku !== p.sku)))}>{t("添加")}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
