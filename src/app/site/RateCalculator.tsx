"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { useT } from "@/components/I18n";

/** 首屏互动试算：选目的地、拖重量，价格实时变化（示意价格，不是实时报价） */
const DESTS = [
  { id: "sd", city: "San Diego, CA", zip: "92101", zone: 3 },
  { id: "sea", city: "Seattle, WA", zip: "98101", zone: 5 },
  { id: "dal", city: "Dallas, TX", zip: "75201", zone: 6 },
  { id: "chi", city: "Chicago, IL", zip: "60601", zone: 7 },
  { id: "nyc", city: "New York, NY", zip: "10001", zone: 8 },
];

const CARRIERS = [
  { id: "gofo", name: "Gofo Express", logo: "/carriers/gofo.png", days: "2–5", base: 2.85, lb: 0.42, z: 0.2 },
  { id: "uniuni", name: "UniUni Express", logo: "/carriers/uniuni.svg", days: "2–5", base: 2.95, lb: 0.4, z: 0.22 },
  { id: "usps", name: "USPS Ground Advantage", logo: "/carriers/usps.png", days: "2–5", base: 4.1, lb: 0.6, z: 0.38 },
  { id: "fedex", name: "FedEx Ground", logo: "", days: "1–5", base: 8.4, lb: 0.52, z: 0.46 },
];

export default function RateCalculator() {
  const t = useT();
  const [dest, setDest] = useState(DESTS[3]);
  const [lb, setLb] = useState(1.5);
  const rows = CARRIERS.map((c) => ({ ...c, price: Math.round((c.base + c.lb * lb + c.z * (dest.zone - 2)) * 100) / 100 })).sort((a, b) => a.price - b.price);
  const max = Math.max(...rows.map((r) => r.price));

  return (
    <div className="us-window calc" aria-label={t("运费试算")}>
      <div className="us-window-bar"><i /><i /><i /><span>{t("运费比价")}</span><em className="calc-live"><b /> {t("可以试试")}</em></div>
      <div className="us-window-body">
        <div className="calc-route">
          <div><small>{t("发件")}</small><b>Los Angeles, CA 90058</b></div>
          <ArrowRight size={16} />
          <div><small>{t("收件")}</small><b>{dest.city} {dest.zip}</b></div>
          <span className="calc-zone">Zone {dest.zone}</span>
        </div>

        <div className="calc-dests" role="radiogroup" aria-label={t("目的地")}>
          {DESTS.map((d) => (
            <button key={d.id} type="button" role="radio" aria-checked={d.id === dest.id} className={d.id === dest.id ? "on" : ""} onClick={() => setDest(d)}>
              {d.city.split(",")[0]}
            </button>
          ))}
        </div>

        <label className="calc-weight">
          <span>{t("重量")}</span>
          <input type="range" min={0.25} max={20} step={0.25} value={lb} onChange={(e) => setLb(Number(e.target.value))} aria-label={t("重量")} />
          <b>{lb.toFixed(2).replace(/\.?0+$/, "")} lb</b>
        </label>

        <div className="calc-rows">
          {rows.map((r, i) => (
            <div key={r.id} className={`calc-row${i === 0 ? " best" : ""}`}>
              <span className="carrier-mark md">
                {r.logo ? <img src={r.logo} alt={r.name} /> : <span className="carrier-text fedex"><b>Fed</b><i>Ex</i></span>}
              </span>
              <div className="calc-name">
                <b>{r.name}</b>
                <small>{t("{d} 天", { d: r.days })}</small>
              </div>
              <div className="calc-bar"><i style={{ width: `${(r.price / max) * 100}%` }} /></div>
              <div className="calc-price">{i === 0 && <em>{t("最低价")}</em>}${r.price.toFixed(2)}</div>
            </div>
          ))}
        </div>
        <p className="us-window-note">{t("示意价格，实际以登录后的实时报价为准")}</p>
      </div>
    </div>
  );
}
