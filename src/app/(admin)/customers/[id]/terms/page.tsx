import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomer } from "@/lib/db";
import { getAcceptance, lastAcceptance, listAcceptances } from "@/lib/terms";
import { fmtTime, TZ_LABEL } from "@/lib/time";
import { getT } from "@/lib/prefs";
import PrintButton from "@/components/PrintButton";

/** 客户签署的服务条款存档：签署时的客户信息 + 条款原文，可以打印 / 另存为 PDF */
export default async function CustomerTermsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ a?: string }> }) {
  const c = getCustomer(Number((await params).id));
  if (!c) notFound();
  const t = await getT();
  const pick = Number((await searchParams).a);
  const a = (pick && getAcceptance(c.id, pick)) || lastAcceptance(c.id);
  const history = listAcceptances(c.id);
  return (
    <>
      <div className="row no-print" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{t("服务条款签署存档")} · {c.name}</h1>
        <div className="row">
          {a && <PrintButton />}
          <Link href={`/customers/${c.id}`}>{t("← 返回客户")}</Link>
        </div>
      </div>
      {history.length > 1 && (
        <div className="card no-print">
          <h2>{t("签署记录")}</h2>
          <table className="list">
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{t("第 {v} 版", { v: h.version })}</td>
                  <td>{[h.signer, h.signerTitle].filter(Boolean).join(" · ")}</td>
                  <td className="small muted">{fmtTime(h.acceptedAt)}</td>
                  <td>{h.id === a?.id ? <b className="small">{t("正在查看")}</b> : <Link href={`/customers/${c.id}/terms?a=${h.id}`} className="small">{t("查看")}</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!a ? (
        <div className="alert warn">{t("这个客户还没有签署服务条款。")}</div>
      ) : (
        <div className="card terms-archive">
          <dl className="terms-party">
            <dt>{t("客户名称")}</dt><dd>{a.party?.customer ?? c.name}</dd>
            <dt>{t("地址")}</dt><dd>{a.party?.address || "—"}</dd>
            <dt>{t("联系人")}</dt><dd>{a.party?.contact || "—"}{a.party?.title ? ` · ${a.party.title}` : ""}</dd>
            <dt>{t("电话")}</dt><dd>{a.party?.phone || "—"}</dd>
            <dt>{t("邮箱")}</dt><dd>{a.party?.email || "—"}</dd>
            <dt>{t("签署人")}</dt><dd>{a.signer}{a.signerTitle ? ` · ${a.signerTitle}` : ""}</dd>
            <dt>{t("签署时间")}</dt><dd>{fmtTime(a.acceptedAt)}（{t(TZ_LABEL)}）</dd>
            <dt>{t("条款版本")}</dt><dd>{t("第 {v} 版", { v: a.version })}{a.ip ? ` · IP ${a.ip}` : ""}</dd>
          </dl>
          <div className="terms-body print-full">{a.text}</div>
        </div>
      )}
    </>
  );
}
