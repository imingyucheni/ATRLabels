import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireCustomer } from "@/lib/auth";
import { apiEnabled, listKeys, listLogs, RATE_PER_MIN } from "@/lib/api/keys";
import { publicBase } from "@/lib/stores/web";
import { fmtTime } from "@/lib/time";
import { getT } from "@/lib/prefs";
import FlashForm from "@/components/FlashForm";
import ApiKeyCreate from "@/components/ApiKeyCreate";
import { revokeApiKeyAction } from "@/app/portal/actions";

export const dynamic = "force-dynamic";

/** API 对接：生成 / 作废密钥、看调用记录 */
export default async function PortalApiPage() {
  const me = await requireCustomer();
  if (!apiEnabled(me.id)) redirect("/portal");
  const t = await getT();
  const base = `${publicBase({ headers: await headers() })}/api/v1`;
  const keys = listKeys(me.id);
  const logs = listLogs(me.id, 50);
  return (
    <>
      <h1>{t("API 对接")}</h1>
      <p className="muted">{t("用 API 把报价、出单、取面单、查状态、取消接进你们自己的 ERP / OMS（例如领星）。价格、规则和余额与客户中心完全一样。")}</p>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>{t("接口信息")}</h2>
          <a className="btn" href="/site/developers" target="_blank">{t("查看接口文档")} ↗</a>
        </div>
        <div className="api-info">
          <div><span className="muted small">Base URL</span><div><code>{base}</code></div></div>
          <div><span className="muted small">{t("鉴权")}</span><div><code>Authorization: Bearer atr_…</code></div></div>
          <div><span className="muted small">{t("频率限制")}</span><div>{t("每个密钥每分钟 {n} 次", { n: RATE_PER_MIN })}</div></div>
          <div><span className="muted small">OpenAPI</span><div><a href="/api/v1/openapi.json" target="_blank">openapi.json ↗</a></div></div>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>{t("建议先用测试密钥调通（模拟出单、不扣钱），再换正式密钥。用领星对接时，把密钥填到物流商授权的 API Key / Token 一栏。")}</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t("生成新密钥")}</h2>
        <ApiKeyCreate />
      </div>

      <div className="card table-wrap">
        <h2 style={{ marginTop: 0 }}>{t("我的密钥")}</h2>
        <table>
          <thead><tr><th>{t("名称")}</th><th>{t("类型")}</th><th>{t("密钥")}</th><th>{t("IP 白名单")}</th><th>{t("创建时间")}</th><th>{t("最近使用")}</th><th></th></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} style={k.revokedAt ? { opacity: 0.55 } : undefined}>
                <td>{k.name}</td>
                <td><span className={`badge ${k.mode === "live" ? "ok" : "test"}`}>{k.mode === "live" ? t("正式") : t("测试")}</span></td>
                <td><code>{k.prefix}…</code></td>
                <td className="small">{k.ipAllow.length ? k.ipAllow.join(", ") : <span className="muted">{t("不限制")}</span>}</td>
                <td className="small muted">{fmtTime(k.createdAt)}</td>
                <td className="small muted">{k.lastUsedAt ? fmtTime(k.lastUsedAt) : "-"}</td>
                <td>
                  {k.revokedAt ? <span className="small muted">{t("已作废")}</span> : (
                    <FlashForm action={revokeApiKeyAction} submitLabel="作废" submitClass="small" inline confirm="作废后用这个密钥的系统会马上调用失败，确定作废吗？">
                      <input type="hidden" name="id" value={k.id} />
                    </FlashForm>
                  )}
                </td>
              </tr>
            ))}
            {!keys.length && <tr><td colSpan={7} className="muted">{t("还没有密钥")}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap">
        <h2 style={{ marginTop: 0 }}>{t("最近调用（最多 50 条，保留 30 天）")}</h2>
        <table>
          <thead><tr><th>{t("时间")}</th><th>{t("密钥")}</th><th>{t("请求")}</th><th>{t("结果")}</th><th className="num">{t("耗时")}</th><th>IP</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="small muted">{fmtTime(l.createdAt)}</td>
                <td className="small"><code>{l.keyPrefix ? `${l.keyPrefix}…` : "-"}</code></td>
                <td className="small"><code>{l.method} {l.path.replace("/api/v1", "")}</code></td>
                <td className="small">
                  <span className={`badge ${l.status < 300 ? "ok" : l.status < 500 ? "pending" : "exception"}`}>{l.status} {l.code}</span>
                  {l.message && l.status >= 300 && <div className="muted" style={{ maxWidth: 360 }}>{l.message}</div>}
                </td>
                <td className="num small muted">{l.ms ?? "-"} ms</td>
                <td className="small muted">{l.ip ?? "-"}</td>
              </tr>
            ))}
            {!logs.length && <tr><td colSpan={6} className="muted">{t("还没有调用记录")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
