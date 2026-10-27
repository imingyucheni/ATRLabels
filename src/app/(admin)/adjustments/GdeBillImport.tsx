"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { importGdeBillAction, previewGdeBillAction } from "@/app/gdeBillActions";
import type { GdePreview } from "@/lib/gdeBill";
import { GDE_ISSUE_LABEL, GDE_KIND_LABEL } from "@/lib/gdeBillShared";
import { money } from "@/lib/pricing";
import FilePick from "@/components/FilePick";
import { useT, useTMsg } from "@/components/I18n";

/** 嘉谷（GDE）对账单：上传 → 分析（每张表、要补差的单、要核对的单）→ 确认导入 */
export default function GdeBillImport() {
  const router = useRouter();
  const t = useT();
  const tm = useTMsg();
  const [form, setForm] = useState<FormData | null>(null);
  const [baseDiff, setBaseDiff] = useState(true);
  const [preview, setPreview] = useState<GdePreview | null>(null);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const withOpts = (fd: FormData, diff: boolean) => {
    const f = new FormData();
    f.set("file", fd.get("file") as File);
    if (diff) f.set("baseDiff", "1");
    return f;
  };

  function analyze(fd: FormData, diff = baseDiff) {
    setError(null);
    start(async () => {
      const r = await previewGdeBillAction(withOpts(fd, diff));
      if (r.error || !r.preview) {
        setError(r.error ?? t("读取失败"));
        setPreview(null);
        return;
      }
      setForm(fd);
      setFilename(r.filename ?? "");
      setPreview(r.preview);
    });
  }

  function onImport() {
    if (!form || !preview) return;
    const p = preview;
    const msg = t("确认导入这个账单？\n新的 {n} 行会记下来（以后再上传同一个累计账单时自动跳过）。\n记补差 {c} 笔：服务商 {cost}，向客户补收 {cust}（马上记入客户余额；嘉谷少收的不退给客户）。\n需要核对的 {i} 条不会动客户余额。", {
      n: p.totals.newLines, c: p.charges.length, cost: money(p.totals.costToBook), cust: money(p.totals.customerTotal), i: p.issues.filter((x) => x.level === "warn").length,
    });
    if (!window.confirm(msg)) return;
    start(async () => {
      const r = await importGdeBillAction(withOpts(form, baseDiff));
      if (r.error) return setError(r.error);
      router.push(`/adjustments/gde/${r.billId}`);
    });
  }

  const warns = preview?.issues.filter((i) => i.level === "warn") ?? [];
  const infos = preview?.issues.filter((i) => i.level === "info") ?? [];
  const sum = preview?.summary;

  return (
    <div className="card">
      <h2>{t("嘉谷（GDE）对账单")}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t("嘉谷每周发的 Excel 账单直接上传（一周一张表、累计的也可以）：系统按运单号 / 我们的单号对应到订单，补收的费用和运费账单多收的差额按这一单下单时的加价比例向客户补收（只补不退，嘉谷少收的只记在我们的成本上）；已取消的单还被收费、状态对不上的单进“嘉谷账单待核对”，和嘉谷沟通处理。以前导入过的行自动跳过。")}
      </p>
      <form action={(fd) => analyze(fd)} className="row">
        <FilePick name="file" accept=".xlsx" required />
        <label className="small"><input type="checkbox" checked={baseDiff} onChange={(e) => { setBaseDiff(e.target.checked); if (form) analyze(form, e.target.checked); }} /> {t("运费账单和下单成本的差额也补差")}</label>
        <button disabled={busy}>{busy && !preview ? t("分析中…") : t("分析账单")}</button>
      </form>

      {error && <div className="alert err" style={{ marginTop: 12 }}>{tm(error)}</div>}

      {preview && (
        <>
          <h3>{filename}</h3>
          {preview.totals.newLines > 0 && !preview.totals.matched && <div className="alert warn">{t("新的行一单都没对应上系统里的订单：请确认现在是正式环境（不是模拟 / 沙盒），以及这是我们自己账户的账单。")}</div>}
          {!preview.totals.newLines && <div className="alert info">{t("这个账单里的 {n} 行之前都导入过了，没有新的内容。", { n: preview.totals.lines })}</div>}
          <div className="stats">
            <div className="stat"><div className="muted">{t("新的行")}</div><div className="v">{preview.totals.newLines}</div><div className="small muted">{t("之前导入过 {n} 行（跳过）", { n: preview.totals.alreadyImported })}</div>{preview.totals.revised > 0 && <div className="small warn-text">{t("其中 {n} 行金额和以前导入的不一样（要核对）", { n: preview.totals.revised })}</div>}</div>
            <div className="stat"><div className="muted">{t("新账单金额")}</div><div className="v">{money(preview.totals.newBilled)}</div><div className="small muted">{t("对应到系统订单 {n} 行", { n: preview.totals.matched })}</div></div>
            <div className="stat"><div className="muted">{t("记补差")}</div><div className="v">{preview.charges.length}</div><div className="small muted">{t("服务商 {a}", { a: money(preview.totals.costToBook) })}</div></div>
            <div className="stat"><div className="muted">{t("向客户补收")}</div><div className="v">{money(preview.totals.customerTotal)}</div><div className="small muted">{t(preview.policyLabel)}</div></div>
            <div className="stat"><div className="muted">{t("需要核对")}</div><div className={`v ${warns.length ? "profit-neg" : ""}`}>{warns.length}</div></div>
            <div className="stat"><div className="muted">{t("系统里没有的单")}</div><div className="v">{preview.notInSystem.count}</div><div className="small muted">{money(preview.notInSystem.total)}</div></div>
          </div>

          {sum && (
            <p className="small">
              <b>{t("嘉谷账户（汇总表）")}</b>{t("：")}{t("付款合计 {a}", { a: money(sum.paymentTotal) })}
              {sum.balance !== null && <> · {t("结余 {a}", { a: money(sum.balance) })}</>}
              {sum.extras.filter((x) => x.value).map((x) => <span key={x.label}> · {t(x.label)} {money(x.value)}</span>)}
            </p>
          )}

          <details>
            <summary>{t("账单里的表（{n} 张）", { n: preview.sheets.length })}</summary>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t("表")}</th><th>{t("类型")}</th><th className="num">{t("行数")}</th><th className="num">{t("金额")}</th><th className="num">{t("新的行")}</th><th className="num">{t("新增金额")}</th></tr></thead>
                <tbody>
                  {preview.sheets.map((s) => (
                    <tr key={s.name} className={s.newLines ? "" : "muted"}>
                      <td>{s.name}</td>
                      <td className="small">{t(GDE_KIND_LABEL[s.kind])}</td>
                      <td className="num">{s.lines}</td>
                      <td className="num">{money(s.total)}{s.stated !== null && Math.abs(s.stated - s.total) > 0.005 && <div className="small warn-text">{t("表里写的合计 {a}", { a: money(s.stated) })}</div>}</td>
                      <td className="num">{s.newLines || "-"}</td>
                      <td className="num">{s.newLines ? money(s.newTotal) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {warns.length > 0 && (
            <>
              <h3>{t("需要核对（导入后进“嘉谷账单待核对”，不动客户余额）")}</h3>
              <IssueTable issues={warns} />
            </>
          )}

          <h3>{t("记补差（{n} 笔）", { n: preview.charges.length })}</h3>
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
            <table>
              <thead><tr><th>{t("类型")}</th><th>{t("运单号")}</th><th>{t("订单 / 客户")}</th><th className="num">{t("服务商")}</th><th className="num">{t("向客户")}</th><th>{t("说明")}</th></tr></thead>
              <tbody>
                {preview.charges.map((c, i) => (
                  <tr key={i}>
                    <td className="small">{c.kind === "extra" ? t("补收") : t("运费差额")}{c.costAmount < 0 && <div className="profit-pos">{t("嘉谷少收，不退客户")}</div>}<div className="muted">{c.sheet}</div></td>
                    <td className="small">{c.tracking || c.refNo}</td>
                    <td>{c.shipmentId ? <>{c.customNo}<div className="small muted">{c.customerName}</div></> : <span className="warn-text small">{t("不自动关联")}</span>}</td>
                    <td className="num">{money(c.costAmount)}</td>
                    <td className="num"><b>{money(c.customerAmount)}</b></td>
                    <td className="small">{tm(c.reason)}<div className="muted">{c.detail}</div></td>
                  </tr>
                ))}
                {!preview.charges.length && <tr><td colSpan={6} className="muted">{t("没有要补差的单")}</td></tr>}
              </tbody>
            </table>
          </div>

          {infos.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary>{t("其他说明（{n} 条）", { n: infos.length })}</summary>
              <IssueTable issues={infos} />
            </details>
          )}
          {preview.notInSystem.count > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary>{t("系统里没有的单（{n} 行，{a}）：直接在嘉谷下的单等，只记录，不补差", { n: preview.notInSystem.count, a: money(preview.notInSystem.total) })}</summary>
              <div className="table-wrap" style={{ maxHeight: 300, overflowY: "auto" }}>
                <table>
                  <thead><tr><th>{t("表")}</th><th>{t("运单号")}</th><th>{t("客户单号")}</th><th className="num">{t("金额")}</th></tr></thead>
                  <tbody>{preview.notInSystem.lines.map((l, i) => <tr key={i}><td className="small">{l.sheet}</td><td className="small">{l.tracking}</td><td className="small">{l.refNo}</td><td className="num">{money(l.amount)}</td></tr>)}</tbody>
                </table>
              </div>
            </details>
          )}

          <div className="row" style={{ marginTop: 14 }}>
            <button className="primary" onClick={onImport} disabled={busy || !preview.totals.newLines}>{busy ? t("处理中…") : t("确认导入")}</button>
          </div>
        </>
      )}
    </div>
  );
}

function IssueTable({ issues }: { issues: GdePreview["issues"] }) {
  const t = useT();
  const tm = useTMsg();
  return (
    <div className="table-wrap" style={{ maxHeight: 320, overflowY: "auto" }}>
      <table>
        <thead><tr><th>{t("问题")}</th><th>{t("表")}</th><th>{t("运单号")}</th><th>{t("订单")}</th><th className="num">{t("金额")}</th><th>{t("说明")}</th></tr></thead>
        <tbody>
          {issues.map((x, i) => (
            <tr key={i}>
              <td className="small"><span className={`badge ${x.type === "cancelled_charged" ? "exception" : x.level === "warn" ? "warn" : ""}`}>{t(GDE_ISSUE_LABEL[x.type])}</span></td>
              <td className="small">{x.sheet}</td>
              <td className="small">{x.tracking}</td>
              <td className="small">{x.shipmentId ? <a href={`/shipments/${x.shipmentId}`}>{x.customNo}</a> : "-"}</td>
              <td className="num">{money(x.amount)}</td>
              <td className="small">{tm(x.message)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
