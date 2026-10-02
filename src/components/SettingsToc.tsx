"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18n";

/** 设置页目录：按用途分组，点了跳到对应那块并展开。这个站点没有的块（正式 / 沙盒不同）自动隐藏。 */
const GROUPS: [string, [string, string][]][] = [
  ["渠道与价格", [["channels", "物流渠道"], ["rules", "全局加价规则"], ["promotions", "限时活动价"], ["limits", "重量 / 尺寸限制"], ["stamp", "面单加印 SKU"]]],
  ["服务商连接", [["shipbest", "ShipBest"], ["jiagu", "嘉谷万邑"], ["shipgrid", "ShipGrid"], ["dhl", "DHL 国际"], ["ebay", "eBay"], ["addr", "地址核对"], ["mail", "邮件通知"]]],
  ["收款与财务", [["payment", "收款方式"], ["finance-pin", "财务确认密码"]]],
  ["客户与官网", [["terms", "服务条款"], ["site", "官网与联系方式"]]],
  ["维护", [["cleanup", "清除测试数据"], ["sandbox-reset", "清空沙盒"]]],
];

export default function SettingsToc() {
  const t = useT();
  const [present, setPresent] = useState<Set<string> | null>(null);
  useEffect(() => {
    setPresent(new Set(GROUPS.flatMap(([, items]) => items.map(([id]) => id)).filter((id) => document.getElementById(id))));
  }, []);
  const groups = GROUPS.map(([g, items]) => [g, items.filter(([id]) => !present || present.has(id))] as const).filter(([, items]) => items.length);
  return (
    <nav className="set-toc" aria-label={t("设置目录")}>
      {groups.map(([g, items]) => (
        <div key={g} className="set-toc-group">
          <span className="set-toc-title">{t(g)}</span>
          {items.map(([id, label]) => (
            <a key={id} href={`#${id}`}>{t(label)}</a>
          ))}
        </div>
      ))}
    </nav>
  );
}
