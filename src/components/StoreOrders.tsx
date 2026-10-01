"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { importStoreOrdersAction } from "@/app/portal/actions";
import { useT } from "@/components/I18n";

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
}

type Pkg = { length: string; width: string; height: string; weight: string; unit: number };

const STATUS: Record<StoreOrderView["status"], [string, string]> = {
  open: ["待处理", "pending"],
  imported: ["已导入待出单", ""],
  shipped: ["已发货 · 已回传", "labeled"],
  closed: ["已关闭", ""],
};

/** 店铺订单列表：勾选待处理的订单，选默认包裹尺寸，导入批量下单 */
export default function StoreOrders({ rows, presets }: { rows: StoreOrderView[]; presets: { length: number; width: number; height: number; weight: number; unit: number }[] }) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const p0 = presets[0];
  const [pkg, setPkg] = useState<Pkg>(p0 ? { length: String(p0.length), width: String(p0.width), height: String(p0.height), weight: String(p0.weight), unit: p0.unit } : { length: "", width: "", height: "", weight: "", unit: 3 });
  // 能勾选导入的：待处理且收件信息完整
  const open = rows.filter((r) => r.status === "open" && !r.issue);
  const blocked = rows.filter((r) => r.status === "open" && r.issue).length;
  const all = open.length > 0 && open.every((r) => sel.has(r.id));
  const [lu, wu] = pkg.unit === 3 ? ["in", "lb"] : pkg.unit === 2 ? ["cm", "kg"] : ["cm", "g"];
  const toggle = (id: number) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  function onImport() {
    setError(null);
    start(async () => {
      const r = await importStoreOrdersAction({ orderIds: [...sel], pkg: { length: Number(pkg.length), width: Number(pkg.width), height: Number(pkg.height), weight: Number(pkg.weight), unit: pkg.unit } });
      if (r.error) return setError(r.error);
      router.push(`/portal/batch?job=${r.jobId}`);
    });
  }

  return (
    <>
      {(open.length > 0 || blocked > 0) && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{t("导入到批量下单")}</h2>
          <p className="small muted">{t("店铺订单里没有包裹尺寸：先选这批订单的默认包裹。订单有重量时用订单重量，没有时用下面的默认重量。导入后在批量下单页可以逐单修改尺寸、选渠道、提交出单；出单后运单号会自动回传到店铺。")}</p>
          {presets.length > 0 && (
            <div className="pkg-presets">
              <span className="small muted">{t("常用尺寸")}</span>
              {presets.map((p, i) => {
                const [a, b] = p.unit === 3 ? ["in", "lb"] : p.unit === 2 ? ["cm", "kg"] : ["cm", "g"];
                const on = pkg.unit === p.unit && pkg.length === String(p.length) && pkg.width === String(p.width) && pkg.height === String(p.height) && pkg.weight === String(p.weight);
                return (
                  <button key={i} type="button" className={`chip${on ? " on" : ""}`} onClick={() => setPkg({ length: String(p.length), width: String(p.width), height: String(p.height), weight: String(p.weight), unit: p.unit })}>
                    {p.length}×{p.width}×{p.height} {a} · {p.weight} {b}
                  </button>
                );
              })}
            </div>
          )}
          <div className="grid">
            <label className="f">{t("单位")}
              <select value={pkg.unit} onChange={(e) => setPkg({ ...pkg, unit: Number(e.target.value) })}>
                <option value={3}>lb / in</option>
                <option value={2}>kg / cm</option>
                <option value={1}>g / cm</option>
              </select>
            </label>
            {(["length", "width", "height"] as const).map((k) => (
              <label key={k} className="f"><span className="req">{t({ length: "长（{u}）", width: "宽（{u}）", height: "高（{u}）" }[k], { u: lu })}</span>
                <input type="number" min="0" step="0.01" value={pkg[k]} onChange={(e) => setPkg({ ...pkg, [k]: e.target.value })} />
              </label>
            ))}
            <label className="f"><span className="req">{t("默认重量（{u}）", { u: wu })}</span>
              <input type="number" min="0" step="0.001" value={pkg.weight} onChange={(e) => setPkg({ ...pkg, weight: e.target.value })} />
            </label>
          </div>
          {error && <div className="alert err" style={{ marginTop: 12 }}>{t(error)}</div>}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" disabled={busy || !sel.size} onClick={onImport}>{busy ? t("导入中…") : t("导入到批量下单（{n} 单）", { n: sel.size })}</button>
            <span className="small muted">{t("已勾选 {n} / {m} 个待处理订单", { n: sel.size, m: open.length })}</span>
            {blocked > 0 && <span className="small" style={{ color: "var(--warn)" }}>{t("另有 {n} 单收件信息不全，补全后再同步就能导入", { n: blocked })}</span>}
          </div>
        </div>
      )}

      <div className="card table-wrap">
        <table className="list">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                {open.length > 0 && <input type="checkbox" aria-label={t("全选")} checked={all} onChange={() => setSel(all ? new Set() : new Set(open.map((r) => r.id)))} />}
              </th>
              <th>{t("店铺订单号")}</th><th>{t("店铺")}</th><th>{t("收件人")}</th><th>{t("商品")}</th><th className="num">{t("重量")}</th><th>{t("状态")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.status === "open" && !r.issue && <input type="checkbox" aria-label={t("选择")} checked={sel.has(r.id)} onChange={() => toggle(r.id)} />}</td>
                <td><b>{r.name}</b><div className="small muted">{r.orderedAt ? r.orderedAt.slice(0, 16).replace("T", " ") : ""}</div></td>
                <td className="small"><span className={`badge ${r.platform === "shopify" ? "ok" : ""}`}>{r.platform === "shopify" ? "Shopify" : "eBay"}</span><div className="muted">{r.storeName}</div></td>
                <td className="small wrap">
                  {r.issue === "no_address" ? <span className="muted">—</span> : r.recipient}
                  {r.issue && (
                    <div style={{ color: "var(--warn)" }}>
                      {r.issue === "no_address" ? t("缺收件地址：请在店铺订单里补上收货地址") : t("缺收件人姓名 / 街道地址：请在店铺订单里补全")}
                    </div>
                  )}
                </td>
                <td className="small wrap">{r.items}</td>
                <td className="num small">{r.weightGrams > 0 ? `${(r.weightGrams / 453.59237).toFixed(2)} lb` : <span className="muted">{t("默认")}</span>}</td>
                <td className="small">
                  <span className={`badge ${STATUS[r.status][1]}`}>{t(STATUS[r.status][0])}</span>
                  {r.trackingNo && <div>{r.shipmentId ? <a href={`/portal/shipments/${r.shipmentId}`}>{r.trackingNo}</a> : r.trackingNo}</div>}
                  {r.status === "imported" && r.jobId && <div><a href={`/portal/batch?job=${r.jobId}`}>{t("去出单 →")}</a></div>}
                  {r.pushError && <div style={{ color: "var(--warn)", maxWidth: 240 }}>{t("回传店铺失败，稍后自动重试")}{t("：")}{r.pushError}</div>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="muted">{t("没有订单")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
