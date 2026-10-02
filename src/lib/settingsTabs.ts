/** 设置页的页签：每块设置（SettingsSection 的 id）属于哪个页签。页面和菜单共用。 */
export const SETTINGS_TABS = [
  { key: "providers", label: "服务商", sections: [["shipbest", "ShipBest"], ["jiagu", "嘉谷万邑"], ["shipgrid", "ShipGrid"], ["dhl", "DHL 国际"]] },
  { key: "pricing", label: "渠道与价格", sections: [["channels", "物流渠道"], ["rules", "全局加价规则"], ["promotions", "限时活动价"], ["limits", "重量 / 尺寸限制"], ["stamp", "面单加印 SKU"]] },
  { key: "customers", label: "客户与官网", sections: [["site", "官网与联系方式"], ["terms", "服务条款"], ["ebay", "eBay 店铺对接"]] },
  { key: "finance", label: "收款与财务", sections: [["payment", "收款方式"], ["finance-pin", "财务确认密码"]] },
  { key: "system", label: "系统", sections: [["addr", "地址核对"], ["mail", "邮件通知"], ["cleanup", "清除测试数据"], ["sandbox-reset", "清空沙盒"]] },
] as const satisfies readonly { key: string; label: string; sections: readonly (readonly [string, string])[] }[];

export type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];
export const DEFAULT_SETTINGS_TAB: SettingsTab = "providers";

export const isSettingsTab = (v: unknown): v is SettingsTab => SETTINGS_TABS.some((t) => t.key === v);

/** 在页签里的排序（按上面列的顺序） */
export function sectionOrder(id: string): number {
  for (const t of SETTINGS_TABS) {
    const i = t.sections.findIndex(([s]) => s === id);
    if (i >= 0) return i;
  }
  return 99;
}

/** 某块设置在哪个页签（没登记的默认放“系统”） */
export function tabOfSection(id: string): SettingsTab {
  return SETTINGS_TABS.find((t) => t.sections.some(([s]) => s === id))?.key ?? "system";
}
