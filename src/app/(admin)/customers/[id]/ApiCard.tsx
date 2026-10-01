import FlashForm from "@/components/FlashForm";
import { apiEnabled, listKeys, listLogs } from "@/lib/api/keys";
import { fmtTime } from "@/lib/time";
import { getT } from "@/lib/prefs";
import { adminRevokeApiKeyAction, setApiEnabledAction } from "@/app/actions";

/** 后台客户详情：开放 API（开通开关、密钥、最近调用） */
export default async function ApiCard({ customerId }: { customerId: number }) {
  const t = await getT();
  const on = apiEnabled(customerId);
  const keys = listKeys(customerId);
  const logs = listLogs(customerId, 10);
  const fails = logs.filter((l) => l.status >= 400).length;
  return (
    <div className="card" id="api">
      <h2 style={{ marginTop: 0 }}>{t("开放 API")} <span className="badge test">{t("测试中")}</span></h2>
      <FlashForm action={setApiEnabledAction} submitLabel={on ? "关闭" : "开通 API"} submitClass={on ? "small" : "small primary"} className={`alert ${on ? "ok" : ""}`}
        confirm={on ? "关闭后这个客户的所有 API 密钥马上失效，对接的系统会调用失败。确定关闭吗？" : undefined}>
        <input type="hidden" name="customerId" value={customerId} />
        <input type="hidden" name="on" value={on ? "0" : "1"} />
        <div style={{ marginBottom: 8 }}>
          {on
            ? t("已开通：客户在 OMS「API 对接」里自己生成密钥，接进他们的 ERP / OMS。")
            : t("未开通：开通后客户 OMS 里会出现「API 对接」，可以生成测试密钥（模拟出单）和正式密钥。")}
          {" "}<a href="/site/developers" target="_blank">{t("接口文档")} ↗</a>
        </div>
      </FlashForm>
      {keys.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t("名称")}</th><th>{t("类型")}</th><th>{t("密钥")}</th><th>{t("最近使用")}</th><th></th></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} style={k.revokedAt ? { opacity: 0.55 } : undefined}>
                  <td>{k.name}{k.ipAllow.length > 0 && <div className="small muted">IP: {k.ipAllow.join(", ")}</div>}</td>
                  <td><span className={`badge ${k.mode === "live" ? "ok" : "test"}`}>{k.mode === "live" ? t("正式") : t("测试")}</span></td>
                  <td><code>{k.prefix}…</code></td>
                  <td className="small muted">{k.lastUsedAt ? fmtTime(k.lastUsedAt) : "-"}</td>
                  <td>
                    {k.revokedAt ? <span className="small muted">{t("已作废")}</span> : (
                      <FlashForm action={adminRevokeApiKeyAction} submitLabel="作废" submitClass="small danger" inline confirm="作废后用这个密钥的系统会马上调用失败，确定作废吗？">
                        <input type="hidden" name="id" value={k.id} />
                      </FlashForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {logs.length > 0 && (
        <p className="small muted" style={{ marginBottom: 0 }}>
          {t("最近 {n} 次调用，失败 {f} 次；最近一次：{time} {req} → {status}", { n: logs.length, f: fails, time: fmtTime(logs[0].createdAt), req: `${logs[0].method} ${logs[0].path.replace("/api/v1", "")}`, status: `${logs[0].status} ${logs[0].code ?? ""}` })}
        </p>
      )}
    </div>
  );
}
