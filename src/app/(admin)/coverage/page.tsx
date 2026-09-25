import { getSettings, listChannels } from "@/lib/db";
import { blockStats, listCoverage } from "@/lib/coverage";
import { dimRule, rateStats } from "@/lib/rates";
import { fmtTime } from "@/lib/time";
import FlashForm from "@/components/FlashForm";
import CoverageUpload from "@/components/CoverageUpload";
import ZipLookup from "@/components/ZipLookup";
import { getT } from "@/lib/prefs";
import { clearBlocksAction, removeCoverageAction, saveDimRuleAction, setPrefilterAction } from "@/app/actions";

export default async function CoveragePage() {
  const t = await getT();
  const channels = listChannels();
  const sources = new Map(listCoverage().map((c) => [c.channelCode, c]));
  const blocks = blockStats();
  const rates = rateStats();
  const totalBlocks = Object.values(blocks).reduce((a, n) => a + n, 0);
  return (
    <>
      <h1>{t("派送范围与价格表")}</h1>
      <div className="card">
        <h2>{t("怎么判断一个地址能不能送")}</h2>
        <ol className="small" style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 6 }}>
          <li><b>{t("以 ShipBest 试算结果为准")}</b>{t("：每个渠道都会问一次接口，送不到的会返回“不通邮”，系统自动隐藏这个渠道。")}</li>
          <li>
            <b>{t("自动记忆")}</b>{t("：接口回复“不通邮”的 渠道 + 邮编会记住 30 天，之后同一邮编直接跳过这个渠道，批量导入更快。")}
            {t("当前记住 {n} 条。", { n: totalBlocks.toLocaleString() })}
          </li>
          <li>
            <b>{t("模拟报价")}</b>{t("：模拟模式下，成本 = 报价表里“计费重量 + 分区”对应的价格。计费重量 = 实重和体积重取大的（体积重 = 长×宽×高 ÷ 系数，按磅向上取整）。")}
            {t("各渠道的系数在下表里改，填 0 表示不算体积重；USPS 默认超过 1728 立方英寸（1 立方英尺）才算体积重。")}
          </li>
          <li>
            <b>{t("邮编表（可选）")}</b>{t("：服务商报价表里的邮编表可以上传作参考，并可按渠道打开“预筛”。")}
            {t("实测（80 次真实试算）表里没有、但实际能送的约占 11%，SPX 尤其多，所以默认不预筛，建议只在确认表格准确的渠道打开。")}
          </li>
        </ol>
      </div>

      <CoverageUpload
        gateway={getSettings().originGateway}
        channels={channels.filter((c) => c.enabled).map((c) => ({ code: c.code, name: c.name }))}
      />

      <div className="card table-wrap">
        <h2>{t("各渠道的邮编表")}</h2>
        <table className="list">
          <thead><tr><th>{t("渠道")}</th><th>{t("邮编表")}</th><th>{t("口岸")}</th><th className="num">{t("表内邮编")}</th><th>{t("按邮编表预筛")}</th><th>{t("价格表（模拟报价用）")}</th><th>{t("体积重")}</th><th className="num">{t("记住的不通邮")}</th><th></th></tr></thead>
          <tbody>
            {channels.map((c) => {
              const s = sources.get(c.code);
              return (
                <tr key={c.code}>
                  <td>{c.name}<div className="small muted">{c.code}{c.enabled ? "" : ` · ${t("已停用")}`}</div></td>
                  <td>{s ? <>{s.sheet}<div className="small muted">{s.filename}</div></> : <span className="muted">{t("未上传（全部交给接口判断）")}</span>}</td>
                  <td>{s?.gateway ?? "-"}</td>
                  <td className="num">{s ? s.zipCount.toLocaleString() : "-"}</td>
                  <td>
                    {s ? (
                      <FlashForm action={setPrefilterAction} submitLabel={s.prefilter ? "关闭" : "打开"} submitClass="small" inline
                        confirm={s.prefilter ? undefined : "打开后，不在邮编表里的地址不再试算这个渠道（可能漏掉实际能送的地址）。确定？"}>
                        <input type="hidden" name="code" value={c.code} />
                        <input type="hidden" name="on" value={s.prefilter ? "0" : "1"} />
                        <span className={`badge ${s.prefilter ? "ok" : "cancelled"}`} style={{ marginRight: 8 }}>{t(s.prefilter ? "已打开" : "只作参考")}</span>
                      </FlashForm>
                    ) : "-"}
                  </td>
                  <td className="small">{rates[c.code] ? t("{n} 个重量档", { n: rates[c.code].rows }) : <span className="muted">{t("未导入")}</span>}</td>
                  <td>
                    {(() => {
                      const r = dimRule(c.code, c.name);
                      return (
                        <FlashForm action={saveDimRuleAction} submitLabel="保存" submitClass="small" className="dim-form" review confirm="体积重规则会影响这个渠道所有客户的报价">
                          <input type="hidden" name="code" value={c.code} />
                          <label className="small">{t("长×宽×高(英寸) ÷")} <input name="divisor" type="number" min="0" step="1" defaultValue={r.divisor} style={{ width: 64 }} /></label>
                          <label className="small">{t("超过")} <input name="minCubic" type="number" min="0" step="1" defaultValue={r.minCubic} style={{ width: 70 }} /> {t("立方英寸才算")}</label>
                        </FlashForm>
                      );
                    })()}
                  </td>
                  <td className="num">
                    {blocks[c.code] ? (
                      <FlashForm action={clearBlocksAction} submitLabel="清除" submitClass="small" inline confirm="清除后这些邮编下次会重新向 ShipBest 查询。确定？">
                        <input type="hidden" name="code" value={c.code} />
                        <span style={{ marginRight: 8 }}>{blocks[c.code].toLocaleString()}</span>
                      </FlashForm>
                    ) : "-"}
                  </td>
                  <td>
                    {s && (
                      <FlashForm action={removeCoverageAction} submitLabel="移除邮编表" submitClass="small" confirm="移除这个渠道的邮编表？">
                        <input type="hidden" name="code" value={c.code} />
                      </FlashForm>
                    )}
                    {s && <div className="small muted">{fmtTime(s.uploadedAt)}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ZipLookup />
    </>
  );
}
