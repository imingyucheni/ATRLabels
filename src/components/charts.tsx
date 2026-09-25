"use client";

/**
 * 报表图表（纯 SVG，无第三方库）。颜色全部走 CSS 变量（--series-1/2、--chart-*），浅色 / 深色各自一套。
 * 规范：细线 2px、柱子顶端 4px 圆角并贴底、柱间 2px 间隙、网格和坐标轴弱化；
 * 每个图都有悬停提示（柱状图逐柱提示、折线图十字线）；数值同时在下方表格里可查。
 */
import { useEffect, useRef, useState } from "react";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** 坐标轴刻度：取整的 4~5 个刻度 */
function ticks(max: number, n = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 100) / 100);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

const fmt = (v: number, money: boolean) =>
  money ? `$${v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : v.toFixed(v < 10 ? 2 : 0)}` : String(Math.round(v));

const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

interface Tip {
  x: number;
  y: number;
  title: string;
  rows: { label: string; value: string; color?: string }[];
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
      <div className="chart-tip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.label} className="chart-tip-row">
          {r.color && <span className="chart-key-line" style={{ background: r.color }} />}
          <b>{r.value}</b>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

const PAD = { l: 44, r: 12, t: 12, b: 26 };

/* ---------------- 每日订单：柱状图（单系列） ---------------- */

export function DailyBars({ data }: { data: { date: string; orders: number; revenue: number; profit: number }[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState(-1);
  const h = 220;
  const max = Math.max(1, ...data.map((d) => d.orders));
  const t = ticks(max);
  const top = t[t.length - 1];
  const iw = width - PAD.l - PAD.r;
  const ih = h - PAD.t - PAD.b;
  const slot = iw / Math.max(1, data.length);
  const bw = Math.max(2, Math.min(28, slot - 2)); // 2px 间隙
  const y = (v: number) => PAD.t + ih - (v / top) * ih;
  const every = Math.ceil(data.length / Math.max(2, Math.floor(iw / 48)));

  return (
    <div ref={ref} className="chart" onPointerLeave={() => { setTip(null); setHover(-1); }}>
      <svg width={width} height={h} role="img" aria-label="每日订单数柱状图">
        {t.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={width - PAD.r} y1={y(v)} y2={y(v)} className="chart-grid" />
            <text x={PAD.l - 8} y={y(v)} className="chart-axis" textAnchor="end" dominantBaseline="middle">{v}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = PAD.l + i * slot + (slot - bw) / 2;
          const bh = Math.max(d.orders ? 2 : 0, (d.orders / top) * ih);
          const r = Math.min(4, bw / 2, bh);
          const yb = PAD.t + ih;
          // 顶部圆角、底部贴基线的柱子
          const path = bh
            ? `M${x},${yb} L${x},${yb - bh + r} Q${x},${yb - bh} ${x + r},${yb - bh} L${x + bw - r},${yb - bh} Q${x + bw},${yb - bh} ${x + bw},${yb - bh + r} L${x + bw},${yb} Z`
            : "";
          return (
            <g key={d.date}>
              {path && <path d={path} fill="var(--series-1)" opacity={hover === -1 || hover === i ? 1 : 0.45} />}
              {/* 命中区域比柱子大：整个时间格 */}
              <rect
                x={PAD.l + i * slot}
                y={PAD.t}
                width={slot}
                height={ih}
                fill="transparent"
                tabIndex={0}
                onPointerMove={(e) => {
                  setHover(i);
                  const box = ref.current!.getBoundingClientRect();
                  setTip({
                    x: Math.min(e.clientX - box.left + 12, width - 170),
                    y: Math.max(0, e.clientY - box.top - 60),
                    title: d.date,
                    rows: [
                      { label: "订单", value: String(d.orders) },
                      { label: "客户消费", value: `$${d.revenue.toFixed(2)}` },
                      { label: "利润", value: `$${d.profit.toFixed(2)}` },
                    ],
                  });
                }}
                onFocus={() => {
                  setHover(i);
                  setTip({ x: Math.min(x, width - 170), y: 0, title: d.date, rows: [{ label: "订单", value: String(d.orders) }] });
                }}
              />
              {i % every === 0 && (
                <text x={PAD.l + i * slot + slot / 2} y={h - 8} className="chart-axis" textAnchor="middle">{shortDate(d.date)}</text>
              )}
            </g>
          );
        })}
        <line x1={PAD.l} x2={width - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} className="chart-baseline" />
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/* ---------------- 每日收入与利润：折线图（两个系列，同单位同一坐标轴） ---------------- */

export function RevenueLines({ data }: { data: { date: string; revenue: number; profit: number }[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [idx, setIdx] = useState(-1);
  const h = 240;
  const pad = { ...PAD, r: 64 }; // 右侧留给末端直接标注
  const max = Math.max(1, ...data.map((d) => Math.max(d.revenue, d.profit)));
  const min = Math.min(0, ...data.map((d) => d.profit));
  const t = ticks(max - min);
  const top = min + t[t.length - 1];
  const iw = width - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const x = (i: number) => pad.l + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - ((v - min) / (top - min)) * ih;
  const line = (k: "revenue" | "profit") => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(" ");
  const every = Math.ceil(data.length / Math.max(2, Math.floor(iw / 48)));
  const last = data[data.length - 1];
  const series = [
    { k: "revenue" as const, label: "客户消费", color: "var(--series-1)" },
    { k: "profit" as const, label: "利润", color: "var(--series-2)" },
  ];

  return (
    <div
      ref={ref}
      className="chart"
      onPointerMove={(e) => {
        const box = ref.current!.getBoundingClientRect();
        const px = e.clientX - box.left;
        const i = Math.round(((px - pad.l) / iw) * (data.length - 1));
        setIdx(Math.max(0, Math.min(data.length - 1, i)));
      }}
      onPointerLeave={() => setIdx(-1)}
    >
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.k}><span className="chart-key-line" style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
      <svg width={width} height={h} role="img" aria-label="每日客户消费与利润折线图">
        {t.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(min + v)} y2={y(min + v)} className="chart-grid" />
            <text x={pad.l - 8} y={y(min + v)} className="chart-axis" textAnchor="end" dominantBaseline="middle">{fmt(min + v, true)}</text>
          </g>
        ))}
        {data.map((d, i) => i % every === 0 && (
          <text key={d.date} x={x(i)} y={h - 8} className="chart-axis" textAnchor="middle">{shortDate(d.date)}</text>
        ))}
        {series.map((s) => (
          <path key={s.k} d={line(s.k)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {/* 末端直接标注（两条线，少于 4 个系列都直接标注） */}
        {last && series.map((s, j) => {
          const ly = y(last[s.k]);
          const other = y(last[series[1 - j].k]);
          const dy = Math.abs(ly - other) < 14 ? (ly < other ? -7 : 7) : 0;
          return (
            <text key={s.k} x={x(data.length - 1) + 8} y={ly + dy} className="chart-label" dominantBaseline="middle">{s.label}</text>
          );
        })}
        {idx >= 0 && data[idx] && (
          <g>
            <line x1={x(idx)} x2={x(idx)} y1={pad.t} y2={pad.t + ih} className="chart-crosshair" />
            {series.map((s) => (
              <circle key={s.k} cx={x(idx)} cy={y(data[idx][s.k])} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {idx >= 0 && data[idx] && (
        <Tooltip
          tip={{
            x: Math.min(x(idx) + 12, width - 170),
            y: 20,
            title: data[idx].date,
            rows: series.map((s) => ({ label: s.label, value: `$${data[idx][s.k].toFixed(2)}`, color: s.color })),
          }}
        />
      )}
    </div>
  );
}

/* ---------------- 渠道单量：横向柱状图（单系列，按单量排序） ---------------- */

export function ChannelBars({ data }: { data: { name: string; orders: number; share: number; revenue: number; profit: number }[] }) {
  const [tip, setTip] = useState<{ i: number } | null>(null);
  const max = Math.max(1, ...data.map((d) => d.orders));
  return (
    <div className="hbar-list" onPointerLeave={() => setTip(null)}>
      {data.map((d, i) => (
        <div
          key={d.name}
          className={`hbar-row ${tip && tip.i !== i ? "dim" : ""}`}
          tabIndex={0}
          onPointerMove={() => setTip({ i })}
          onFocus={() => setTip({ i })}
          onBlur={() => setTip(null)}
        >
          <div className="hbar-name">{d.name}</div>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(d.orders / max) * 100}%` }} />
          </div>
          <div className="hbar-value"><b>{d.orders}</b> <span>{(d.share * 100).toFixed(1)}%</span></div>
          {tip?.i === i && (
            <div className="chart-tip hbar-tip">
              <div className="chart-tip-title">{d.name}</div>
              <div className="chart-tip-row"><b>{d.orders}</b><span>订单（{(d.share * 100).toFixed(1)}%）</span></div>
              <div className="chart-tip-row"><b>${d.revenue.toFixed(2)}</b><span>客户消费</span></div>
              <div className="chart-tip-row"><b>${d.profit.toFixed(2)}</b><span>利润</span></div>
            </div>
          )}
        </div>
      ))}
      {!data.length && <div className="muted small">这个期间没有订单</div>}
    </div>
  );
}
