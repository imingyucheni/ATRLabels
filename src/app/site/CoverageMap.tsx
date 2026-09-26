"use client";

import { useState } from "react";
import { useT } from "@/components/I18n";

/** 美国本土简化轮廓（经度, 纬度），用来生成点阵地图 */
const US: [number, number][] = [
  [-124.7, 48.4], [-123.0, 49.0], [-95.2, 49.0], [-94.8, 49.4], [-89.6, 48.0], [-84.8, 46.6], [-83.5, 46.1], [-82.5, 43.0], [-82.9, 42.0],
  [-79.0, 43.3], [-76.3, 44.2], [-74.7, 45.0], [-71.5, 45.0], [-70.6, 46.4], [-69.2, 47.4], [-67.8, 47.1], [-67.0, 44.8], [-70.2, 43.6],
  [-70.8, 42.7], [-70.0, 41.7], [-71.9, 41.3], [-74.0, 40.6], [-74.2, 39.6], [-75.5, 38.8], [-75.9, 37.2], [-76.3, 36.9], [-75.6, 35.5],
  [-76.6, 34.7], [-78.0, 33.9], [-79.2, 33.2], [-80.9, 32.0], [-81.4, 30.7], [-80.5, 28.5], [-80.1, 26.5], [-80.4, 25.2], [-81.1, 25.1],
  [-81.8, 26.1], [-82.7, 27.6], [-82.8, 29.2], [-84.0, 30.1], [-85.4, 29.7], [-86.5, 30.4], [-88.1, 30.4], [-89.6, 30.2], [-89.4, 29.2],
  [-90.6, 29.1], [-92.3, 29.6], [-93.8, 29.7], [-95.0, 29.2], [-97.2, 27.6], [-97.4, 26.0], [-99.1, 26.4], [-99.9, 27.8], [-101.4, 29.8],
  [-102.7, 29.7], [-103.3, 29.0], [-104.5, 29.6], [-106.5, 31.8], [-108.2, 31.8], [-111.1, 31.3], [-114.8, 32.5], [-117.1, 32.5],
  [-118.4, 33.8], [-120.6, 34.6], [-121.9, 36.6], [-122.5, 37.8], [-123.7, 39.0], [-124.2, 40.4], [-124.2, 42.0], [-124.5, 43.0], [-124.0, 46.3],
];

const W = 960;
const H = 560;
const px = (lon: number) => ((lon + 125.5) / 59) * W;
const py = (lat: number) => ((49.8 - lat) / 25.5) * H;

function inside([x, y]: [number, number]) {
  let hit = false;
  for (let i = 0, j = US.length - 1; i < US.length; j = i++) {
    const [xi, yi] = US[i];
    const [xj, yj] = US[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const DOTS: [number, number][] = [];
for (let lat = 49.4; lat > 24.6; lat -= 0.6) for (let lon = -124.8; lon < -66.8; lon += 0.6) if (inside([lon, lat])) DOTS.push([px(lon), py(lat)]);

const ORIGIN = { x: px(-117.7), y: py(34.0) };
const CITIES = [
  { id: "sea", name: "Seattle", lon: -122.3, lat: 47.6, zone: 5, days: "2–4" },
  { id: "den", name: "Denver", lon: -105.0, lat: 39.7, zone: 5, days: "2–4" },
  { id: "dal", name: "Dallas", lon: -96.8, lat: 32.8, zone: 6, days: "2–5" },
  { id: "chi", name: "Chicago", lon: -87.6, lat: 41.9, zone: 7, days: "3–5" },
  { id: "atl", name: "Atlanta", lon: -84.4, lat: 33.7, zone: 7, days: "3–5" },
  { id: "mia", name: "Miami", lon: -80.2, lat: 25.8, zone: 8, days: "3–5" },
  { id: "nyc", name: "New York", lon: -74.0, lat: 40.7, zone: 8, days: "3–5" },
].map((c) => ({ ...c, x: px(c.lon), y: py(c.lat) }));

function arc(x: number, y: number) {
  const mx = (ORIGIN.x + x) / 2;
  const my = (ORIGIN.y + y) / 2 - Math.hypot(x - ORIGIN.x, y - ORIGIN.y) * 0.28;
  return `M${ORIGIN.x},${ORIGIN.y} Q${mx},${my} ${x},${y}`;
}

/** 覆盖地图：从洛杉矶发往全美的航线动画，鼠标移到城市上显示分区和时效 */
export default function CoverageMap() {
  const t = useT();
  const [hover, setHover] = useState<string | null>(null);
  const cur = CITIES.find((c) => c.id === hover);
  return (
    <div className="cov">
      <svg viewBox={`0 0 ${W} ${H}`} className="cov-svg" role="img" aria-label={t("从洛杉矶发往全美")}>
        <defs>
          <radialGradient id="cov-glow"><stop offset="0" stopColor="#60a5fa" stopOpacity="0.55" /><stop offset="1" stopColor="#60a5fa" stopOpacity="0" /></radialGradient>
          <linearGradient id="cov-line" x1="0" x2="1"><stop offset="0" stopColor="#93c5fd" /><stop offset="1" stopColor="#ffffff" /></linearGradient>
        </defs>
        <g className="cov-dots">{DOTS.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2} />)}</g>
        <circle cx={ORIGIN.x} cy={ORIGIN.y} r={70} fill="url(#cov-glow)" />
        {CITIES.map((c, i) => (
          <path key={c.id} d={arc(c.x, c.y)} className={`cov-arc${hover && hover !== c.id ? " dim" : ""}${hover === c.id ? " on" : ""}`} style={{ animationDelay: `${i * 0.35}s` }} />
        ))}
        {CITIES.map((c) => (
          <g key={c.id} className="cov-city" onMouseEnter={() => setHover(c.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(c.id)} onBlur={() => setHover(null)} tabIndex={0}>
            <circle cx={c.x} cy={c.y} r={18} fill="transparent" />
            <circle cx={c.x} cy={c.y} r={5} className="cov-pin" />
            <circle cx={c.x} cy={c.y} r={5} className="cov-ping" />
            <text x={c.x + 10} y={c.y - 10}>{c.name}</text>
          </g>
        ))}
        <g>
          <circle cx={ORIGIN.x} cy={ORIGIN.y} r={8} className="cov-origin" />
          <text x={ORIGIN.x + 14} y={ORIGIN.y + 22} className="cov-origin-label">Chino, CA</text>
        </g>
      </svg>
      <div className={`cov-card${cur ? " show" : ""}`}>
        {cur ? (
          <>
            <b>Chino → {cur.name}</b>
            <span>Zone {cur.zone} · {t("常见 {d} 天送达", { d: cur.days })}</span>
          </>
        ) : (
          <span>{t("把鼠标移到城市上看分区和时效")}</span>
        )}
      </div>
    </div>
  );
}
