import SettingsSection from "@/components/SettingsSection";
import { speedSummary } from "@/lib/speedStats";
import { getT } from "@/lib/prefs";
import { fmtTime } from "@/lib/time";

const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** 设置 → 服务商：最近 24 小时各服务商接口（报价、地址核对）的速度，看是哪家慢 */
export default async function SpeedCard() {
  const t = await getT();
  const list = speedSummary();
  const slow = list.find((s) => s.avgMs >= 8000);
  return (
    <SettingsSection
      id="speed"
      title={t("接口速度")}
      summary={list.length ? t("最近 24 小时 {n} 次请求", { n: list.reduce((a, s) => a + s.count, 0) }) : t("还没有记录")}
      badge={slow ? <span className="badge pending">{t("{p} 偏慢", { p: slow.provider })}</span> : undefined}
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        {t("每次查运费、核对地址时，各服务商接口用了多久（只记最近 100 次，服务器重启后清零）。下单页现在查到一个渠道就先显示一个，慢的服务商不会拖住其他渠道；查价最多等 15 秒。")}
      </p>
      {list.length ? (
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th>{t("服务商")}</th><th className="num">{t("次数")}</th><th className="num">{t("平均")}</th><th className="num">{t("90% 在多少秒内")}</th><th className="num">{t("最慢")}</th><th className="num">{t("失败 / 超时")}</th><th>{t("最近一次")}</th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.provider}>
                  <td>{s.provider}</td>
                  <td className="num">{s.count}</td>
                  <td className="num"><b className={s.avgMs >= 8000 ? "warn-text" : undefined}>{sec(s.avgMs)}</b></td>
                  <td className="num">{sec(s.p90Ms)}</td>
                  <td className="num">{sec(s.maxMs)}</td>
                  <td className="num">{s.failed ? <span className="warn-text">{s.failed}</span> : 0}</td>
                  <td className="small muted">{fmtTime(new Date(s.lastAt).toISOString())}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="small muted">{t("查一次运费后这里会显示各服务商的速度。")}</p>
      )}
    </SettingsSection>
  );
}
