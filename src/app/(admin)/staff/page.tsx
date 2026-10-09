import FlashForm from "@/components/FlashForm";
import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { customerLevel, getStaff, listStaff } from "@/lib/staffStore";
import { listCustomers } from "@/lib/db";
import { fmtTime } from "@/lib/time";
import { getT } from "@/lib/prefs";
import { createStaffAction, saveStaffCommissionRateAction, updateStaffAction } from "@/app/staffActions";
import { salesOfStaff } from "@/lib/commission";
import { getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 员工账号（二级管理员）：只有主管理员能管理 */
export default async function StaffPage() {
  await requireAdmin();
  const t = await getT();
  const list = listStaff();
  const customers = listCustomers();
  // 每个员工能操作 / 只能看几个客户
  const scope = (id: number) => {
    const s = getStaff(id);
    const lv = customers.map((c) => customerLevel(s, c.id));
    return { edit: lv.filter((x) => x === "edit").length, view: lv.filter((x) => x === "view").length };
  };
  // staff.json 里存的是 UTC 时间
  const at = (s: string | null) => (s ? fmtTime(s) : "-");
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("管理员账号")}</h1>
          <p className="page-sub">{t("管理员可以：开客户账号、改客户资料和登录、设置客户的渠道和邮费（加价，不能低于全局默认）、确认客户充值；在“我的看板”看自己负责的客户（授权给他的、归他名下的）的消费、面单、成本、利润，以及自己的提成（自己开的客户默认归他）；运费试算（单个包裹和多箱）显示公司成本和利润。看不到其他客户、报表、全部面单记录、系统设置，也不能加款 / 扣款、改信用额度。")}</p>
        </div>
      </div>

      <FlashForm action={saveStaffCommissionRateAction} submitLabel="保存" className="card" review>
        <h2 style={{ marginTop: 0 }}>{t("管理员开的客户：默认提成")}</h2>
        <div className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label className="f" style={{ width: 220 }}>{t("提成比例（利润 %）")}<input name="rate" type="number" min="0" max="100" step="0.01" required defaultValue={getSettings().staffCommissionRate ?? 30} /></label>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>{t("管理员自己新开的客户默认归他：这个客户每单利润按这个比例给管理员，其余归公司（例如 30% 给管理员、70% 归公司）。比例记在每个客户上，之后可以在客户详情 → 渠道与价格 →“销售归属（佣金）”里单独调整；这里改了只影响以后新开的客户。主管理员开的客户默认不归任何管理员，利润全部归公司。")}</p>
      </FlashForm>

      <div className="card table-wrap">
        <table className="card-table">
          <thead><tr><th>{t("姓名")}</th><th>{t("登录名")}</th><th>{t("状态")}</th><th>{t("客户权限")}</th><th>{t("提成（销售）")}</th><th>{t("确认密码")}</th><th>{t("最近登录")}</th><th>{t("操作")}</th></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td className="c-main">{s.name}</td>
                <td data-label={t("登录名")}><code>{s.username}</code></td>
                <td data-label={t("状态")}>{s.active ? <span className="badge ok">{t("正常")}</span> : <span className="badge">{t("已停用")}</span>}</td>
                <td data-label={t("客户权限")}>
                  {(() => {
                    const n = scope(s.id);
                    return (
                      <Link href={`/staff/${s.id}`}>
                        {n.edit + n.view === 0 ? <span className="warn-text">{t("还没授权客户")}</span> : t("能操作 {e} · 只能看 {v}", { e: n.edit, v: n.view })}
                      </Link>
                    );
                  })()}
                </td>
                <td data-label={t("提成（销售）")}>
                  {(() => {
                    const rep = salesOfStaff(s.id);
                    return <Link href={`/staff/${s.id}`}>{rep ? rep.name : <span className="muted">{t("未绑定")}</span>}</Link>;
                  })()}
                </td>
                <td data-label={t("确认密码")}>{s.hasPin ? t("已设置") : <span className="warn-text">{t("还没设置")}</span>}</td>
                <td className="small muted" data-label={t("最近登录")}>{at(s.lastLoginAt)}</td>
                <td className="c-act staff-ops">
                  <details>
                    <summary className="small">{t("管理")}</summary>
                    <div className="staff-op-box">
                      <Link href={`/staff/${s.id}`} className="small">{t("设置客户权限 →")}</Link>
                      <FlashForm action={updateStaffAction} submitLabel="改名" submitClass="small" inline>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="op" value="rename" />
                        <input name="name" defaultValue={s.name} maxLength={40} required style={{ width: 140 }} />
                      </FlashForm>
                      <FlashForm action={updateStaffAction} submitLabel="重置密码" submitClass="small" inline confirm={t("重置【{name}】的登录密码？他之前的登录会失效。", { name: s.name })}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="op" value="password" />
                        <input name="password" type="text" minLength={8} required placeholder={t("新密码（至少 8 位）")} autoComplete="off" style={{ width: 180 }} />
                      </FlashForm>
                      <div className="row" style={{ gap: 8 }}>
                        <FlashForm action={updateStaffAction} submitLabel={s.active ? "停用" : "启用"} submitClass="small" inline confirm={s.active ? t("停用【{name}】？他会立刻被登出，不能再登录。", { name: s.name }) : undefined}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="op" value={s.active ? "disable" : "enable"} />
                        </FlashForm>
                        <FlashForm action={updateStaffAction} submitLabel="删除" submitClass="small danger" inline confirm={t("删除【{name}】的账号？他确认过的充值记录里还会保留他的名字。", { name: s.name })}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="op" value="delete" />
                        </FlashForm>
                      </div>
                    </div>
                  </details>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={7} className="muted">{t("还没有管理员账号")}</td></tr>}
          </tbody>
        </table>
      </div>

      <FlashForm action={createStaffAction} submitLabel="创建管理员账号" className="card" resetOnSuccess>
        <h2 style={{ marginTop: 0 }}>{t("新增管理员")}</h2>
        <div className="grid">
          <label className="f"><span className="req">{t("姓名")}</span><input name="name" required maxLength={40} placeholder={t("确认充值时记录的名字")} /></label>
          <label className="f"><span className="req">{t("登录名")}</span><input name="username" required maxLength={32} pattern="[a-zA-Z0-9._\-]{3,32}" autoCapitalize="none" spellCheck={false} placeholder={t("例如 amy")} /></label>
          <label className="f"><span className="req">{t("初始密码")}</span><input name="password" type="text" required minLength={8} autoComplete="off" placeholder={t("至少 8 位")} /></label>
        </div>
        <p className="small muted">{t("新管理员默认一个客户都看不到，创建后点“客户权限”授权。")} {t("管理员用这个登录名和密码在后台登录页登录。第一次登录后，他要在“我的账号”里设置自己的 4 位确认密码，确认充值时输入；充值记录里会记下是谁确认的。")}</p>
      </FlashForm>
    </>
  );
}
