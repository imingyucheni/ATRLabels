import Link from "next/link";
import GoLiveChecklist from "@/components/GoLiveChecklist";
import { listChannels, listCustomers, listShipments, shipmentProfit } from "@/lib/db";
import { pendingResets } from "@/lib/passwordReset";
import { newLeadCount } from "@/lib/leads";
import { buildReport, localDate } from "@/lib/reports";
import { money } from "@/lib/pricing";
import StatusBadge from "@/components/StatusBadge";
import { pendingTopupCount } from "@/lib/topup";
import Profit from "@/components/Profit";
import { getT, tMsg } from "@/lib/prefs";
import { providerOf } from "@/lib/service";
import { jiaguBalance, LOW_BALANCE_USD } from "@/lib/providerBalance";

/** 和“报表”同一口径：订单数不含已取消 / 异常，含面单生成中的 */
function summarize(from: string, to: string) {
  const r = buildReport(from, to);
  const list = listShipments({ from, to });
  const pending = list.filter((s) => s.status === "pending").length;
  // 测试单（模拟 / 沙盒 / 内部测试账号）不计入统计：页面上说明一下，免得以为统计坏了
  const tests = list.filter((s) => s.isTest && s.status !== "cancelled").length;
  return { count: r.totals.orders, revenue: r.totals.revenue, profit: r.totals.profit, pending, tests };
}

export default async function Dashboard() {
  const today = summarize(localDate(), localDate());
  const month = summarize(localDate().slice(0, 8) + "01", localDate());
  const attention = listShipments({ limit: 200 }).filter((s) =>
    ["pending", "exception", "cancel_requested"].includes(s.status),
  );
  const recent = listShipments({ limit: 10 });
  const noChannels = listChannels().length === 0;
  const pendingTopups = pendingTopupCount();
  const cur = recent[0]?.currency ?? "";
  const t = await getT();
  const errs = await Promise.all(attention.map((s) => tMsg(s.errorMsg)));
  const jg = await jiaguBalance();
  // 待办：每项都能点进去处理
  const customers = listCustomers();
  const owing = customers.filter((c) => c.balance < 0);
  const overLimit = customers.filter((c) => c.balance < -(c.creditLimit ?? 0));
  const todo: { label: string; n: number; href: string; tone?: "warn" | "bad" }[] = [
    { label: t("待审充值"), n: pendingTopups, href: "/finance#topups", tone: "warn" },
    { label: t("取消处理中"), n: attention.filter((s) => s.status === "cancel_requested").length, href: "/shipments?status=cancel_requested", tone: "warn" },
    { label: t("出单异常"), n: attention.filter((s) => s.status === "exception").length, href: "/shipments?status=exception", tone: "bad" },
    { label: t("面单生成中"), n: attention.filter((s) => s.status === "pending").length, href: "/shipments?status=pending" },
    { label: t("密码重置申请"), n: pendingResets().length, href: "/customers" },
    { label: t("新客户咨询"), n: newLeadCount(), href: "/leads" },
    { label: t("超出信用额度的客户"), n: overLimit.length, href: "/customers", tone: "bad" },
  ];
  const owed = owing.reduce((a, c) => a + c.balance, 0);
  const prepaid = customers.filter((c) => c.balance > 0).reduce((a, c) => a + c.balance, 0);

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{t("概览")}</h1>
        <form action="/shipments" method="get" className="dash-search">
          <input name="q" type="search" placeholder={t("查单号 / 运单号 / 收件人")} aria-label={t("查单号 / 运单号 / 收件人")} />
        </form>
      </div>
      <GoLiveChecklist />
      <div className="todo-row">
        {todo.map((x) => (
          <Link key={x.label} href={x.href} className={`todo${x.n ? ` on ${x.tone ?? ""}` : ""}`}>
            <b>{x.n}</b><span>{x.label}</span>
          </Link>
        ))}
      </div>
      {noChannels && (
        <div className="alert warn">
          {t("还没有同步物流渠道，请先到")} <Link href="/settings">{t("设置")}</Link> {t("点“同步渠道”，并设置加价规则。")}
        </div>
      )}
      {jg.enabled && (() => {
        const low = !!jg.value && jg.value.usd + jg.value.credit < LOW_BALANCE_USD;
        return (
          <div className={`card provider-bal${low ? " low" : ""}`}>
            <div className="card-head"><h2>{t("服务商余额")}</h2><Link href="/reconcile" className="small">{t("服务商对账")} →</Link></div>
            <div className="stats" style={{ margin: 0 }}>
              <div className="stat">
                <div className="muted">{t("嘉谷万邑 余额")}</div>
                <div className={`v${low ? " profit-neg" : ""}`}>{jg.value ? money(jg.value.usd) : "—"}</div>
                <div className="small muted">
                  {jg.value ? (jg.value.credit ? t("信用额度 {v}", { v: money(jg.value.credit) }) : t("每 5 分钟更新")) : t("查询失败（{e}）", { e: jg.error ?? "" })}
                </div>
              </div>
              <div className="stat">
                <div className="muted">{t("ShipBest 余额")}</div>
                <div className="v" style={{ fontSize: 16 }}>{t("接口不提供")}</div>
                <div className="small muted">{t("请在 ShipBest OMS 后台查看")}</div>
              </div>
            </div>
            {low && <div className="alert err" style={{ margin: "12px 0 0" }}><b>{t("嘉谷余额不多了，请尽快充值，否则嘉谷渠道会下单失败。")}</b></div>}
          </div>
        );
      })()}
      <div className="stats">
        <div className="stat"><div className="muted">{t("今日出单")}</div><div className="v">{today.count}</div>{today.pending > 0 && <div className="small muted">{t("含面单生成中 {n} 单", { n: today.pending })}</div>}</div>
        <div className="stat"><div className="muted">{t("今日打单金额")}</div><div className="v">{money(today.revenue)}</div></div>
        <div className="stat"><div className="muted">{t("今日利润")}</div><div className="v">{money(today.profit)}</div></div>
        <div className="stat"><div className="muted">{t("本月出单")}</div><div className="v">{month.count}</div></div>
        <div className="stat"><div className="muted">{t("本月打单金额")}</div><div className="v">{money(month.revenue)}</div></div>
        <div className="stat"><div className="muted">{t("本月利润")}</div><div className="v">{money(month.profit)}</div></div>
        <div className="stat"><div className="muted">{t("客户预付余额合计")}</div><div className="v">{money(prepaid)}</div></div>
        <div className="stat"><div className="muted">{t("客户欠款合计")}</div><div className={`v${owed < 0 ? " profit-neg" : ""}`}>{money(-owed)}</div>{owing.length > 0 && <div className="small muted">{t("{n} 个客户余额为负", { n: owing.length })}</div>}</div>
      </div>
      {(today.tests > 0 || month.tests > 0) && (
        <p className="small muted" style={{ marginTop: -8 }}>{t("测试单不计入以上统计（今日 {a} 单，本月 {b} 单测试单）。", { a: today.tests, b: month.tests })}</p>
      )}

      {attention.length > 0 && (
        <div className="card">
          <h2>{t("需要处理（{n}）", { n: attention.length })}</h2>
          <div className="table-wrap">
          <table>
            <tbody>
              {attention.map((s, i) => (
                <tr key={s.id}>
                  <td><Link href={`/shipments/${s.id}`}>{s.customNo}</Link></td>
                  <td>{s.customerName}</td>
                  <td className="small">{t(providerOf(s.channelCode))}</td>
                  <td><StatusBadge status={s.status} test={s.isTest} /></td>
                  <td className="small muted">{errs[i]} <Link href={`/shipments/${s.id}#provider`} className="small">{t("服务商反馈")}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{t("最近面单")}</h2>
          <Link className="btn primary" href="/quote">{t("运费试算")}</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{t("单号")}</th><th>{t("客户")}</th><th>{t("渠道")}</th><th>{t("运单号")}</th><th>{t("状态")}</th><th className="num">{t("客户价")}</th><th className="num">{t("利润")}</th></tr>
            </thead>
            <tbody>
              {recent.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/shipments/${s.id}`}>{s.customNo}</Link></td>
                  <td>{s.customerName}</td>
                  <td>{s.channelName}</td>
                  <td>{s.trackingNo ?? "-"}</td>
                  <td><StatusBadge status={s.status} test={s.isTest} /></td>
                  <td className="num">{money(s.price, s.currency)}</td>
                  <td className="num"><Profit value={shipmentProfit(s)} /></td>
                </tr>
              ))}
              {!recent.length && <tr><td colSpan={7} className="muted">{t("暂无记录")}</td></tr>}
            </tbody>
          </table>
        </div>
        {cur && <p className="small muted">{t("金额币种以 ShipBest 返回为准（{cur}）。", { cur })}</p>}
      </div>
    </>
  );
}
