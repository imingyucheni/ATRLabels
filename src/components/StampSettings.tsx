"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { saveChannelStampAction, saveStampAction, uploadChannelSampleAction } from "@/app/actions";
import type { StampOverride, StampSettings as Global } from "@/lib/stampConfig";

type Field = "x" | "y" | "fontSize" | "maxWidth" | "rotate";

/** 面单加印 SKU 设置：全局默认 + 每个渠道单独调整位置，右侧实时预览 */
export default function StampSettings({ global, channels }: { global: Global; channels: { code: string; name: string; stamp: StampOverride | null }[] }) {
  const [target, setTarget] = useState<string>(""); // "" = 全局默认
  const [g, setG] = useState<Global>(global);
  const [ov, setOv] = useState<Record<string, StampOverride>>(Object.fromEntries(channels.map((c) => [c.code, c.stamp ?? {}])));
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [busy, start] = useTransition();
  const [src, setSrc] = useState("");

  const cur = target ? ov[target] ?? {} : null;
  const eff = useMemo(() => ({ ...g, ...Object.fromEntries(Object.entries(cur ?? {}).filter(([, v]) => v !== undefined && v !== null)) }), [g, cur]);

  // 参数变化 400ms 后刷新预览
  useEffect(() => {
    const q = new URLSearchParams({
      channel: target,
      x: String(eff.x), y: String(eff.y), fontSize: String(eff.fontSize), maxWidth: String(eff.maxWidth), maxLines: String(eff.maxLines),
      rotate: String(eff.rotate), whiteBg: eff.whiteBg ? "1" : "0", bold: eff.bold ? "1" : "0", prefix: eff.prefix,
      showQty: eff.showQty ? "1" : "0", separator: eff.separator,
    });
    const t = setTimeout(() => setSrc(`/api/labels/preview?${q}`), 400);
    return () => clearTimeout(t);
  }, [eff, target]);

  const setField = (k: Field, v: string) => {
    const n = v === "" ? undefined : Number(v);
    if (target) setOv((o) => ({ ...o, [target]: { ...o[target], [k]: n } }));
    else if (n !== undefined) setG((x) => ({ ...x, [k]: n }));
  };
  const val = (k: Field) => (target ? (cur?.[k] ?? "") : g[k]);

  function save() {
    setMsg(null);
    start(async () => {
      const r = target ? await saveChannelStampAction(target, ov[target] ?? {}) : await saveStampAction(g);
      setMsg(r);
    });
  }

  const num = (k: Field, label: string, step = "0.05") => (
    <label className="f">{label}
      <input type="number" step={step} value={val(k)} placeholder={target ? `默认 ${g[k]}` : undefined} onChange={(e) => setField(k, e.target.value)} />
    </label>
  );

  return (
    <div className="card">
      <h2>面单加印 SKU</h2>
      <p className="small muted">
        面单出来后，打印 / 下载 / 合并打印时自动在指定位置印上这一单的 SKU（原始面单不改动，面单详情页可以下载原始版本）。
        不同渠道的面单版式不同，可以选择渠道单独开关、调整位置。位置按 4×6 英寸面单计算：距左边、距上边多少英寸。
      </p>
      <p className="small muted">
        目前 UniUni、GOFO、SwiftX 等渠道的面单，ShipBest 已经在备注 / Remarks 里印了 SKU，不需要加印；<b>USPS 面单没有这一栏，默认只给 USPS 加印</b>，
        位置在最下面一栏左侧空白（条码框下方、右下角二维码左边）。
      </p>
      <div className="alert warn small">请把文字放在面单的空白处，<b>不要盖住条码、运单号和地址</b>（尤其开启白底时），否则承运商可能无法扫描。每个渠道设置后先用预览确认。</div>
      <div className="grid2">
        <div>
          <div className="grid" style={{ marginBottom: 12 }}>
            <label className="f">正在编辑
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">全局默认</option>
                {channels.map((c) => (
                  <option key={c.code} value={c.code}>
                    渠道：{c.name}{ov[c.code]?.enabled === true ? "（加印）" : ov[c.code]?.enabled === false ? "（不加印）" : Object.values(ov[c.code] ?? {}).some((v) => v !== undefined && v !== null) ? "（已单独设置）" : ""}
                  </option>
                ))}
              </select>
            </label>
            {!target ? (
              <label className="f" style={{ justifyContent: "flex-end" }}>
                <span><input type="checkbox" checked={g.enabled} onChange={(e) => setG({ ...g, enabled: e.target.checked })} /> 所有渠道默认加印</span>
              </label>
            ) : (
              <label className="f">这个渠道
                <select
                  value={cur?.enabled === true ? "on" : cur?.enabled === false ? "off" : ""}
                  onChange={(e) => setOv((o) => ({ ...o, [target]: { ...o[target], enabled: e.target.value === "on" ? true : e.target.value === "off" ? false : undefined } }))}
                >
                  <option value="">跟随全局（{g.enabled ? "加印" : "不加印"}）</option>
                  <option value="on">加印 SKU</option>
                  <option value="off">不加印（面单上已有 SKU）</option>
                </select>
              </label>
            )}
          </div>
          <div className="grid">
            {num("x", "距左边（英寸）")}
            {num("y", "距上边（英寸）")}
            {num("fontSize", "字号（pt）", "0.5")}
            {num("maxWidth", "最大宽度（英寸）")}
            <label className="f">文字方向
              <select value={String(val("rotate"))} onChange={(e) => setField("rotate", e.target.value)}>
                {target && <option value="">跟随全局（{g.rotate}°）</option>}
                <option value="0">横向 0°</option>
                <option value="90">逆时针 90°</option>
                <option value="180">180°</option>
                <option value="270">顺时针 90°</option>
              </select>
            </label>
          </div>
          {!target && (
            <>
              <h3>文字内容</h3>
              <div className="grid">
                <label className="f">前缀<input value={g.prefix} onChange={(e) => setG({ ...g, prefix: e.target.value })} /></label>
                <label className="f">多个 SKU 分隔符<input value={g.separator} onChange={(e) => setG({ ...g, separator: e.target.value })} /></label>
                <label className="f">最多行数<input type="number" min={1} max={5} value={g.maxLines} onChange={(e) => setG({ ...g, maxLines: Number(e.target.value) || 1 })} /></label>
              </div>
              <div className="row" style={{ marginTop: 8, gap: 16 }}>
                <label className="small"><input type="checkbox" checked={g.showQty} onChange={(e) => setG({ ...g, showQty: e.target.checked })} /> 数量大于 1 时显示 “x数量”</label>
                <label className="small"><input type="checkbox" checked={g.whiteBg} onChange={(e) => setG({ ...g, whiteBg: e.target.checked })} /> 文字加白底</label>
                <label className="small"><input type="checkbox" checked={g.bold} onChange={(e) => setG({ ...g, bold: e.target.checked })} /> 粗体</label>
              </div>
              <p className="small muted">只能印英文、数字和常见符号（面单打印机字体限制），中文会显示成 “?”。每张面单也可以在详情页单独填写要印的文字。</p>
            </>
          )}
          {target && (
            <>
              <p className="small muted">留空的项跟随全局默认。</p>
              <div className="card" style={{ background: "var(--bg)", marginBottom: 0 }}>
                <div className="small" style={{ marginBottom: 6 }}>
                  <b>上传该渠道的示例面单</b>：从 ShipBest 后台下载一张这个渠道的面单（PDF / PNG），上传后预览就用它，按真实版式找空白位置。
                </div>
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    fd.set("channel", target);
                    setMsg(null);
                    start(async () => {
                      const r = await uploadChannelSampleAction(fd);
                      setMsg(r);
                      if (r?.ok) setSrc((s0) => s0 + "&t=" + Date.now());
                    });
                  }}
                >
                  <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg" required style={{ maxWidth: 260 }} />
                  <button className="small" disabled={busy}>上传</button>
                </form>
              </div>
            </>
          )}
          {msg?.ok && <div className="alert ok">{msg.ok}</div>}
          {msg?.error && <div className="alert err">{msg.error}</div>}
          <button className="primary" onClick={save} disabled={busy} style={{ marginTop: 12 }}>{busy ? "保存中…" : target ? "保存该渠道位置" : "保存加印设置"}</button>
        </div>
        <div>
          <div className="small muted" style={{ marginBottom: 4 }}>预览</div>
          {src && <iframe key={src} src={src} title="预览" style={{ width: "100%", height: 560, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />}
        </div>
      </div>
    </div>
  );
}
