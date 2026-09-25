import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { db, getSettings, listChannels } from "@/lib/db";
import { isSandboxSite, shipbestConfig } from "@/lib/shipbest/client";
import { hasTestData, testDataStats } from "@/lib/cleanup";
import { getT } from "@/lib/prefs";

/** 上线检查清单：全部完成前显示在后台概览顶部（沙盒站不显示） */
export default async function GoLiveChecklist() {
  if (isSandboxSite()) return null;
  const t = await getT();
  const sb = shipbestConfig();
  const s = getSettings();
  const stats = testDataStats();
  const opened = (db().prepare("SELECT COUNT(DISTINCT customer_id) AS n FROM customer_channels").get() as { n: number }).n;
  const https = (process.env.ADMIN_URL || process.env.APP_URL || "").startsWith("https://");
  const items: { done: boolean; label: string; hint: string; href: string }[] = [
    { done: !!(sb.apiId && sb.token), label: "填写 ShipBest API 账号", hint: "设置 → ShipBest 连接", href: "/settings#shipbest" },
    { done: sb.mode === "live", label: "切换到正式模式", hint: "先用“沙盒”核对真实价格，没问题再切“正式”", href: "/settings#shipbest" },
    { done: listChannels().length > 0, label: "同步物流渠道", hint: "切换模式后点“同步渠道”", href: "/settings#shipbest" },
    { done: opened > 0, label: "给客户开通渠道", hint: "客户详情 → 可用渠道", href: "/customers" },
    { done: !!(s.zelleInfo || s.alipayInfo), label: "填写收款方式", hint: "客户充值页会显示", href: "/settings" },
    { done: https, label: "开启 HTTPS", hint: "在服务器执行 atr-update --reconfigure 填写域名（可以用 sslip.io 免费域名）", href: "/settings" },
    { done: !hasTestData(stats), label: "清除测试数据", hint: "设置页最下面，删掉模拟 / 沙盒订单", href: "/settings#cleanup" },
  ];
  const left = items.filter((i) => !i.done).length;
  if (!left) return null;
  return (
    <div className="card golive">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{t("上线检查清单")}</h2>
        <span className="small muted">{t("已完成 {a} / {b}", { a: items.length - left, b: items.length })}</span>
      </div>
      <ul>
        {items.map((i) => (
          <li key={i.label} className={i.done ? "done" : ""}>
            {i.done ? <CheckCircle2 size={16} strokeWidth={2.2} /> : <Circle size={16} strokeWidth={2} />}
            <Link href={i.href}>{t(i.label)}</Link>
            <span className="small muted">{t(i.hint)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
