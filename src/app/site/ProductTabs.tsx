"use client";

import { useEffect, useState } from "react";
import { Check, FileSpreadsheet, Printer, Receipt, Scale } from "lucide-react";
import { useT } from "@/components/I18n";
import ShippingLabel from "./ShippingLabel";

type Tab = "rates" | "bulk" | "print" | "ledger";

/** 产品展示：四个标签页自动轮播（鼠标移上去暂停），每页一个接近真实系统的界面 */
export default function ProductTabs() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("rates");
  const [paused, setPaused] = useState(false);
  const [paper, setPaper] = useState<"4x6" | "a4" | "letter">("4x6");
  const tabs: { id: Tab; icon: typeof Scale; title: string; desc: string }[] = [
    { id: "rates", icon: Scale, title: t("实时比价"), desc: t("多家渠道同时报价，自动选最低。") },
    { id: "bulk", icon: FileSpreadsheet, title: t("批量导入"), desc: t("Excel 导入上千单，逐单比价。") },
    { id: "print", icon: Printer, title: t("合并打印"), desc: t("4×6、A4、Letter，一次打印。") },
    { id: "ledger", icon: Receipt, title: t("透明对账"), desc: t("每笔扣款、补差逐单可查。") },
  ];

  useEffect(() => {
    if (paused) return;
    const id = setTimeout(() => setTab((cur) => tabs[(tabs.findIndex((x) => x.id === cur) + 1) % tabs.length].id), 7000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, paused]);

  return (
    <div className="pt" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="pt-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={tab === x.id ? "on" : ""} onClick={() => setTab(x.id)}>
            <x.icon size={18} strokeWidth={1.7} />
            <span><b>{x.title}</b><small>{x.desc}</small></span>
            {tab === x.id && <i className={`pt-progress${paused ? " paused" : ""}`} key={`${x.id}-${paused}`} />}
          </button>
        ))}
      </div>

      <div className="pt-stage">
        <div className="pt-frame">
          <div className="us-window-bar"><i /><i /><i /><span>{tabs.find((x) => x.id === tab)!.title}</span></div>
          <div className="pt-body" key={tab}>
            {tab === "rates" && (
              <table className="us-rates">
                <tbody>
                  {[
                    ["/carriers/gofo.png", "Gofo Express", "2–5", "3.39", true],
                    ["/carriers/uniuni.svg", "UniUni Express", "2–5", "3.49"],
                    ["/carriers/speedx.png", "SpeedX", "2–5", "3.82"],
                    ["/carriers/usps.png", "USPS Ground Advantage", "2–5", "5.89"],
                    ["", "FedEx Ground", "1–5", "10.79"],
                  ].map(([logo, name, days, price, best]) => (
                    <tr key={name as string} className={best ? "best" : ""}>
                      <td><span className="carrier-mark md">{logo ? <img src={logo as string} alt={name as string} /> : <span className="carrier-text" style={{ color: "#4d148c" }}>FedEx</span>}</span></td>
                      <td><b>{name}</b><small>{t("{d} 天", { d: days as string })}</small></td>
                      <td className="num">{best && <em>{t("最低价")}</em>}<b>${price}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === "bulk" && (
              <div className="pt-bulk">
                <div className="us-panel-head"><FileSpreadsheet size={16} /> orders_0926.xlsx <span className="us-pill ok">{t("已完成")}</span></div>
                <div className="us-kpis">
                  <div><small>{t("订单")}</small><b>1,248</b></div>
                  <div><small>{t("已报价")}</small><b>1,248</b></div>
                  <div><small>{t("地址问题")}</small><b>0</b></div>
                </div>
                <div className="us-bar"><i /></div>
                <table className="pt-orders">
                  <tbody>
                    {[["#10231", "Houston, TX", "Gofo", "$3.62"], ["#10232", "Brooklyn, NY", "USPS", "$6.14"], ["#10233", "Phoenix, AZ", "UniUni", "$3.28"], ["#10234", "Miami, FL", "SpeedX", "$4.05"]].map(([no, city, ch, p]) => (
                      <tr key={no}><td>{no}</td><td>{city}</td><td>{ch}</td><td className="num">{p}</td><td><span className="us-pill ok"><Check size={11} /> {t("最低")}</span></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "print" && (
              <div className="pt-print">
                <div className="pt-paper" role="radiogroup" aria-label={t("纸张")}>
                  {(["4x6", "a4", "letter"] as const).map((p) => (
                    <button key={p} type="button" role="radio" aria-checked={paper === p} className={paper === p ? "on" : ""} onClick={() => setPaper(p)}>
                      {p === "4x6" ? "4×6" : p === "a4" ? "A4" : "Letter"}
                    </button>
                  ))}
                </div>
                <div className={`pt-sheet ${paper}`}>
                  {(paper === "4x6" ? [0] : [0, 1]).map((i) => <ShippingLabel key={i} variant={i} />)}
                </div>
              </div>
            )}

            {tab === "ledger" && (
              <table className="us-ledger">
                <thead><tr><th>{t("日期")}</th><th>{t("说明")}</th><th className="num">{t("金额")}</th><th className="num">{t("余额")}</th></tr></thead>
                <tbody>
                  <tr><td>09/26</td><td>{t("运费")} · Gofo Express</td><td className="num">−$3.39</td><td className="num muted">$1,284.18</td></tr>
                  <tr><td>09/26</td><td>{t("补差")} · {t("重量复核")}</td><td className="num">−$0.42</td><td className="num muted">$1,287.57</td></tr>
                  <tr><td>09/25</td><td>{t("取消退款")}</td><td className="num pos">+$5.89</td><td className="num muted">$1,287.99</td></tr>
                  <tr><td>09/25</td><td>{t("充值")} · Zelle</td><td className="num pos">+$500.00</td><td className="num muted">$1,282.10</td></tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
