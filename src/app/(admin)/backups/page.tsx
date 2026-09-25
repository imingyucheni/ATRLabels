import FlashForm from "@/components/FlashForm";
import { createBackupAction, deleteBackupAction, restoreBackupAction } from "@/app/actions";
import { BACKUP_KIND_LABEL, listBackups } from "@/lib/backup";
import { currentEnv } from "@/lib/db";
import { getT } from "@/lib/prefs";
import { fmtTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default async function BackupsPage() {
  const t = await getT();
  const list = listBackups();
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{t("数据备份")}</h1>
          <p className="small muted" style={{ margin: 0 }}>
            {t("每天凌晨 3 点自动备份（保留 30 天）；清空测试数据、恢复备份之前也会自动备份。备份包括数据库和面单、充值凭证等文件。只备份正式数据。")}
          </p>
        </div>
        <FlashForm action={createBackupAction} submitLabel="立即备份" inline />
      </div>
      {currentEnv() === "test" && <div className="alert warn" style={{ marginTop: 12 }}>{t("现在是测试环境。这里的备份和恢复都针对正式数据。")}</div>}
      <div className="alert" style={{ marginTop: 12, background: "var(--info-soft)" }}>
        {t("建议定期点“下载”把备份存到自己电脑或网盘：备份都在这台服务器上，服务器出问题时备份也会一起丢。")}
      </div>
      <div className="card table-wrap">
        <table className="list">
          <thead>
            <tr><th>{t("时间")}</th><th>{t("类型")}</th><th>{t("文件")}</th><th className="num">{t("大小")}</th><th>{t("面单等文件")}</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.name}>
                <td className="small">{fmtTime(b.time)}</td>
                <td><span className={`badge ${b.kind === "daily" ? "ok" : b.kind === "manual" ? "test" : "pending"}`}>{t(BACKUP_KIND_LABEL[b.kind])}</span></td>
                <td className="small muted cell-wrap">{b.name}</td>
                <td className="num small">{size(b.size)}</td>
                <td className="small">{b.hasFiles ? t("有") : t("仅数据库")}</td>
                <td>
                  <div className="row" style={{ gap: 6, alignItems: "flex-start" }}>
                    <a className="btn small" href={`/api/backups/${encodeURIComponent(b.name)}`}>{t("下载")}</a>
                    <details className="restore-box">
                      <summary className="btn small">{t("恢复")}</summary>
                      <FlashForm action={restoreBackupAction} submitLabel="恢复到这个备份" submitClass="danger small"
                        confirm="确定恢复到这个备份吗？这个时间点之后的订单、充值、流水都会回到备份时的状态。恢复前的数据会自动另存一份。">
                        <input type="hidden" name="name" value={b.name} />
                        <label className="f" style={{ margin: "8px 0" }}>
                          <span className="req">{t("管理员登录密码")}</span>
                          <input name="adminPassword" type="password" required autoComplete="current-password" />
                        </label>
                      </FlashForm>
                    </details>
                    {b.kind !== "daily" && (
                      <FlashForm action={deleteBackupAction} submitLabel="删除" submitClass="small" inline confirm="删除这个备份？删除后不能恢复。">
                        <input type="hidden" name="name" value={b.name} />
                      </FlashForm>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={6} className="muted">{t("还没有备份。点右上角“立即备份”，或等今晚 3 点的自动备份。")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
