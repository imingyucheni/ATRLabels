"use client";

import { useState } from "react";
import { ArrowRight, Building2, Check, Factory, ShoppingBag } from "lucide-react";
import { useT } from "@/components/I18n";

type Seg = "seller" | "3pl" | "local";

/** “适合谁”：按客户类型切换，每类一个大面板（左边卖点，右边对应的产品界面，数据为示意） */
export default function WhoTabs() {
  const t = useT();
  const [seg, setSeg] = useState<Seg>("seller");
  const segs = [
    { id: "seller" as const, icon: ShoppingBag, label: t("跨境电商卖家") },
    { id: "3pl" as const, icon: Building2, label: t("海外仓 / 3PL") },
    { id: "local" as const, icon: Factory, label: t("本地品牌 / 批发商") },
  ];
  const copy: Record<Seg, { title: string; body: string; points: string[] }> = {
    seller: {
      title: t("多平台订单，一个账户出单"),
      body: t("TikTok Shop、Temu、Shopify、Amazon 自发货订单导出后一次上传，每一单自动选最低渠道。"),
      points: [t("兼容常见导单表格"), t("逐单自动比价"), t("订单号防重复下单")],
    },
    "3pl": {
      title: t("大批量出单，稳定高效"),
      body: t("每天上千单批量导入、比价、合并打印，按客户分开计费，账目清楚。"),
      points: [t("上千单一次导入"), t("4×6 / Letter 合并打印"), t("地址自动核对，少退件")],
    },
    local: {
      title: t("多家渠道，一张账单"),
      body: t("洛杉矶本地发货，预付余额按单扣费，不用再和多家物流分别开户、分别对账。"),
      points: [t("没有月费和最低单量"), t("Zelle / 支付宝充值"), t("对账明细随时导出")],
    },
  };
  const c = copy[seg];

  return (
    <div className="who2">
      <div className="who2-tabs" role="tablist">
        {segs.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={seg === s.id} className={seg === s.id ? "on" : ""} onClick={() => setSeg(s.id)}>
            <s.icon size={16} strokeWidth={1.8} /> {s.label}
          </button>
        ))}
      </div>

      <div className={`who2-panel ${seg}`} key={seg}>
        <div className="who2-copy">
          <h3>{c.title}</h3>
          <p>{c.body}</p>
          <ul>{c.points.map((p) => <li key={p}><Check size={16} /> {p}</li>)}</ul>
          <a href="#contact" className="us-link">{t("聊聊你的需求")} <ArrowRight size={16} /></a>
        </div>

        <div className="who2-visual">
          {seg === "seller" && (
            <div className="wv-card">
              <div className="wv-head"><b>{t("今日订单来源")}</b><span>{t("示意")}</span></div>
              {[
                ["TikTok Shop", 148, "var(--us-ink)"],
                ["Temu", 96, "#fb7701"],
                ["Shopify", 64, "#5e8e3e"],
                ["Amazon", 34, "#ff9900"],
              ].map(([name, n, color]) => (
                <div key={name as string} className="wv-src">
                  <i style={{ background: color as string }} />
                  <span>{name}</span>
                  <div className="wv-track"><em style={{ width: `${((n as number) / 148) * 100}%`, background: color as string }} /></div>
                  <b>{n}</b>
                </div>
              ))}
              <div className="wv-foot"><span className="wv-ok"><Check size={13} /> {t("342 单全部按最低渠道出单")}</span></div>
            </div>
          )}

          {seg === "3pl" && (
            <div className="wv-card">
              <div className="wv-head"><b>{t("本周出单")}</b><span>{t("示意")}</span></div>
              <div className="wv-big">12,480<small>{t("笔订单")}</small></div>
              <div className="wv-bars">
                {[62, 78, 70, 92, 100, 54, 40].map((h, i) => (
                  <div key={i}><i style={{ height: `${h}%` }} /><small>{[t("周一"), t("周二"), t("周三"), t("周四"), t("周五"), t("周六"), t("周日")][i]}</small></div>
                ))}
              </div>
              <div className="wv-chips"><span>{t("批量导入")}</span><span>{t("合并打印")}</span><span>{t("地址核对")}</span></div>
            </div>
          )}

          {seg === "local" && (
            <div className="wv-card">
              <div className="wv-head"><b>{t("9 月账单")}</b><span>{t("示意")}</span></div>
              {[
                ["Gofo Express", 412, "$1,386.20"],
                ["UniUni Express", 268, "$902.44"],
                ["USPS Ground Advantage", 131, "$768.95"],
                ["FedEx Ground", 22, "$241.80"],
              ].map(([name, n, amt]) => (
                <div key={name as string} className="wv-line"><span>{name}</span><small>{t("{n} 单", { n: n as number })}</small><b>{amt}</b></div>
              ))}
              <div className="wv-total"><span>{t("合计")}</span><b>$3,299.39</b></div>
              <div className="wv-foot"><span className="wv-ok"><Check size={13} /> {t("一张账单，四家渠道")}</span></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
