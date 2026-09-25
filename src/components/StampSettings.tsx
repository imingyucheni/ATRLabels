"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { saveChannelStampAction, saveStampAction, uploadChannelSampleAction } from "@/app/actions";
import type { StampOverride, StampSettings as Global } from "@/lib/stampConfig";
import FilePick from "@/components/FilePick";
import { useT, useTMsg } from "@/components/I18n";

type Field = "x" | "y" | "fontSize" | "maxWidth" | "rotate";
/** 4×6 英寸面单上的合理范围 */
const LIMITS: Partial<Record<Field, [number, number]>> = { x: [0, 3.9], y: [0, 5.9], fontSize: [5, 24], maxWidth: [0.5, 4] };

/** 面单加印 SKU 设置：全局默认 + 每个渠道单独调整位置，右侧实时预览 */
export default function StampSettings({ global, channels }: { global: Global; channels: { code: string; name: string; stamp: StampOverride | null }[] }) {
  const [target, setTarget] = useState<string>(""); // "" = 全局默认
  const [g, setG] = useState<Global>(global);
  const [ov, setOv] = useState<Record<string, StampOverride>>(Object.fromEntries(channels.map((c) => [c.code, c.stamp ?? {}])));
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [busy, start] = useTransition();
  const [src, setSrc] = useState("");
  const t = useT();
  const tm = useTMsg();

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
    const timer = setTimeout(() => setSrc(`/api/labels/preview?${q}`), 400);
    return () => clearTimeout(timer);
  }, [eff, target]);

  const setField = (k: Field, v: string) => {
    const n = v === "" ? undefined : Number(v);
    if (target) setOv((o) => ({ ...o, [target]: { ...o[target], [k]: n } }));
    else if (n !== undefined) setG((x) => ({ ...x, [k]: n }));
  };
  const val = (k: Field) => (target ? (cur?.[k] ?? "") : g[k]);
  const outOfRange = (k: Field) => {
    const v = val(k);
    const lim = LIMITS[k];
    return lim && v !== "" && v !== undefined && (Number(v) < lim[0] || Number(v) > lim[1]) ? lim : null;
  };
  const invalid = (["x", "y", "fontSize", "maxWidth"] as Field[]).some((k) => outOfRange(k));

  function save() {
    if (!window.confirm(target ? t("这个渠道所有客户的面单都会按新位置加印，确定保存吗？") : t("加印设置会用于所有客户的面单（客户单独设置的除外），确定保存吗？"))) return;
    setMsg(null);
    start(async () => {
      const r = target ? await saveChannelStampAction(target, ov[target] ?? {}) : await saveStampAction(g);
      setMsg(r);
    });
  }

  const num = (k: Field, label: string, step = "0.05") => {
    const bad = outOfRange(k);
    return (
      <label className="f">{label}
        <input type="number" step={step} min={LIMITS[k]?.[0]} max={LIMITS[k]?.[1]} value={val(k)} aria-invalid={!!bad}
          placeholder={target ? t("默认 {v}", { v: g[k] }) : undefined} onChange={(e) => setField(k, e.target.value)} />
        {bad && <span className="small" style={{ color: "var(--err)" }}>{t("请填 {min}–{max}", { min: bad[0], max: bad[1] })}</span>}
      </label>
    );
  };

  return (
    <div className="card">
      <h2>{t("面单加印 SKU")}</h2>
      <p className="small muted">
        {t("面单出来后，打印 / 下载 / 合并打印时自动在指定位置印上这一单的 SKU（原始面单不改动，面单详情页可以下载原始版本）。")}
        {t("不同渠道的面单版式不同，可以选择渠道单独开关、调整位置。位置按 4×6 英寸面单计算：距左边、距上边多少英寸。")}
      </p>
      <p className="small muted">
        {t("目前 UniUni、GOFO、SwiftX 等渠道的面单，ShipBest 已经在备注 / Remarks 里印了 SKU，不需要加印；")}<b>{t("USPS 面单没有这一栏，默认只给 USPS 加印")}</b>{t("，")}
        {t("位置在最下面一栏左侧空白（条码框下方、右下角二维码左边）。")}
      </p>
      <div className="alert warn small">{t("请把文字放在面单的空白处，")}<b>{t("不要盖住条码、运单号和地址")}</b>{t("（尤其开启白底时），否则承运商可能无法扫描。每个渠道设置后先用预览确认。")}</div>
      <div className="grid2">
        <div>
          <div className="grid" style={{ marginBottom: 12 }}>
            <label className="f">{t("正在编辑")}
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">{t("全局默认")}</option>
                {channels.map((c) => (
                  <option key={c.code} value={c.code}>
                    {t("渠道：")}{c.name}{ov[c.code]?.enabled === true ? t("（加印）") : ov[c.code]?.enabled === false ? t("（不加印）") : Object.values(ov[c.code] ?? {}).some((v) => v !== undefined && v !== null) ? t("（已单独设置）") : ""}
                  </option>
                ))}
              </select>
            </label>
            {!target ? (
              <label className="f" style={{ justifyContent: "flex-end" }}>
                <span><input type="checkbox" checked={g.enabled} onChange={(e) => setG({ ...g, enabled: e.target.checked })} /> {t("所有渠道默认加印")}</span>
              </label>
            ) : (
              <label className="f">{t("这个渠道")}
                <select
                  value={cur?.enabled === true ? "on" : cur?.enabled === false ? "off" : ""}
                  onChange={(e) => setOv((o) => ({ ...o, [target]: { ...o[target], enabled: e.target.value === "on" ? true : e.target.value === "off" ? false : undefined } }))}
                >
                  <option value="">{t("跟随全局（{v}）", { v: g.enabled ? t("加印") : t("不加印") })}</option>
                  <option value="on">{t("加印 SKU")}</option>
                  <option value="off">{t("不加印（面单上已有 SKU）")}</option>
                </select>
              </label>
            )}
          </div>
          <div className="grid">
            {num("x", t("距左边（英寸）"))}
            {num("y", t("距上边（英寸）"))}
            {num("fontSize", t("字号（pt）"), "0.5")}
            {num("maxWidth", t("最大宽度（英寸）"))}
            <label className="f">{t("文字方向")}
              <select value={String(val("rotate"))} onChange={(e) => setField("rotate", e.target.value)}>
                {target && <option value="">{t("跟随全局（{v}）", { v: `${g.rotate}°` })}</option>}
                <option value="0">{t("横向 0°")}</option>
                <option value="90">{t("逆时针 90°")}</option>
                <option value="180">180°</option>
                <option value="270">{t("顺时针 90°")}</option>
              </select>
            </label>
          </div>
          {!target && (
            <>
              <h3>{t("文字内容")}</h3>
              <div className="grid">
                <label className="f">{t("前缀")}<input value={g.prefix} onChange={(e) => setG({ ...g, prefix: e.target.value })} /></label>
                <label className="f">{t("多个 SKU 分隔符")}<input value={g.separator} onChange={(e) => setG({ ...g, separator: e.target.value })} /></label>
                <label className="f">{t("最多行数")}<input type="number" min={1} max={5} value={g.maxLines} onChange={(e) => setG({ ...g, maxLines: Number(e.target.value) || 1 })} /></label>
              </div>
              <div className="row" style={{ marginTop: 8, gap: 16 }}>
                <label className="small"><input type="checkbox" checked={g.showQty} onChange={(e) => setG({ ...g, showQty: e.target.checked })} /> {t("数量大于 1 时显示 “x数量”")}</label>
                <label className="small"><input type="checkbox" checked={g.whiteBg} onChange={(e) => setG({ ...g, whiteBg: e.target.checked })} /> {t("文字加白底")}</label>
                <label className="small"><input type="checkbox" checked={g.bold} onChange={(e) => setG({ ...g, bold: e.target.checked })} /> {t("粗体")}</label>
              </div>
              <p className="small muted">{t("只能印英文、数字和常见符号（面单打印机字体限制），中文会显示成 “?”。每张面单也可以在详情页单独填写要印的文字。")}</p>
            </>
          )}
          {target && (
            <>
              <p className="small muted">{t("留空的项跟随全局默认。")}</p>
              <div className="card" style={{ background: "var(--bg)", marginBottom: 0 }}>
                <div className="small" style={{ marginBottom: 6 }}>
                  <b>{t("上传该渠道的示例面单")}</b>{t("：从 ShipBest 后台下载一张这个渠道的面单（PDF / PNG），上传后预览就用它，按真实版式找空白位置。")}
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
                  <FilePick name="file" accept=".pdf,.png,.jpg,.jpeg" required />
                  <button className="small" disabled={busy}>{t("上传")}</button>
                </form>
              </div>
            </>
          )}
          {msg?.ok && <div className="alert ok">{tm(msg.ok)}</div>}
          {msg?.error && <div className="alert err">{tm(msg.error)}</div>}
          <button className="primary" onClick={save} disabled={busy || invalid} style={{ marginTop: 12 }}>{busy ? t("保存中…") : target ? t("保存该渠道位置") : t("保存加印设置")}</button>
        </div>
        <div>
          <div className="small muted" style={{ marginBottom: 4 }}>{t("预览")}</div>
          {src && <iframe key={src} src={src} title={t("预览")} style={{ width: "100%", height: 560, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />}
        </div>
      </div>
    </div>
  );
}
