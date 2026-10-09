import Link from "next/link";
import { notFound } from "next/navigation";
import FlashForm from "@/components/FlashForm";
import { requireAdmin } from "@/lib/auth";
import { listCustomers } from "@/lib/db";
import { accessOf, customerLevel, getStaff } from "@/lib/staffStore";
import { money } from "@/lib/pricing";
import { getT } from "@/lib/prefs";
import { bindStaffSalesAction, setStaffAccessAction } from "@/app/staffActions";
import { listSales, salesOfStaff } from "@/lib/commission";
import SetAllSelects from "@/components/SetAllSelects";

export const dynamic = "force-dynamic";

/** 员工的客户权限：哪些客户能看、能不能操作 */
export default async function StaffAccessPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const s = getStaff(Number((await params).id));
  if (!s) notFound();
  const t = await getT();
  const a = accessOf(s);
  const customers = listCustomers();
  const level = (cid: number) => customerLevel(s, cid) ?? "none";
  const counts = { edit: 0, view: 0, none: 0 };
  for (const c of customers) counts[level(c.id)]++;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("员工：{name} · 提成和客户权限", { name: s.name })}</h1>
          <p className="page-sub">{t("能操作 {e} 个 · 只能看 {v} 个 · 看不到 {n} 个", { e: counts.edit, v: counts.view, n: counts.none })}</p>
        </div>
        <Link href="/staff">{t("← 返回")}</Link>
      </div>

      {(() => {
        const rep = salesOfStaff(s.id);
        const reps = listSales().filter((r) => r.active && (!r.staffId || r.staffId === s.id));
        return (
          <FlashForm action={bindStaffSalesAction} submitLabel="保存" className="card" alwaysSubmit>
            <input type="hidden" name="id" value={s.id} />
            <h2 style={{ marginTop: 0 }}>{t("提成（绑定销售）")}</h2>
            <p className="small muted">{t("绑定后：这个员工新开的客户自动归到这个销售名下；归属这个销售的客户，订单按“销售佣金”里的比例（客户单独比例 / 销售默认比例）算提成。员工在“我的看板”里能看到自己的提成（应结、已结）。一个客户只能归一个销售，换人在客户详情 → 渠道与价格 → 销售里改。")}</p>
            <div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label className="f" style={{ minWidth: 240 }}>{t("绑定的销售")}
                <select name="salesId" key={rep ? rep.id : "none"} defaultValue={rep ? String(rep.id) : ""}>
                  <option value="">{t("不绑定（不算提成）")}</option>
                  {reps.map((r) => <option key={r.id} value={r.id}>{r.name}{r.rate !== null ? ` · ${r.rate}%` : ""}</option>)}
                  <option value="new">{t("新建同名销售：{name}", { name: s.name })}</option>
                </select>
              </label>
              <label className="f" style={{ width: 200 }}>{t("新建时的默认比例（利润 %，可以不填）")}<input name="rate" type="number" step="0.01" min="0" max="100" placeholder="10" /></label>
            </div>
            {rep && <p className="small" style={{ marginBottom: 0 }}>{t("现在绑定：{name}（默认比例 {rate}）", { name: rep.name, rate: rep.rate !== null ? `${rep.rate}%` : t("未设") })} · <Link href={`/commissions/${rep.id}`}>{t("看佣金明细 →")}</Link></p>}
          </FlashForm>
        );
      })()}

      <FlashForm action={setStaffAccessAction} submitLabel="保存客户权限" className="card" review>
        <input type="hidden" name="id" value={s.id} />
        <fieldset className="f" style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
          <span>{t("以后新增的客户")}</span>
          <label className="check"><input type="radio" name="mode" value="list" defaultChecked={a.mode === "list"} /> {t("默认看不到，需要单独授权（推荐）")}</label>
          <label className="check"><input type="radio" name="mode" value="all" defaultChecked={a.mode === "all"} /> {t("默认能看能操作（下面可以单独排除）")}</label>
        </fieldset>
        <p className="small muted">{t("能操作 = 改客户资料和登录、设置渠道和邮费、确认充值；只能看 = 能看资料、余额和流水，不能改；看不到 = 客户列表里没有这个客户，直接打开也会被挡回去。员工自己新建的客户会自动给他“能操作”。")}</p>
        <SetAllSelects selector=".access-table select" options={[["edit", "能操作"], ["view", "只能看"], ["none", "看不到"]]} />
        <div className="table-wrap">
          <table className="card-table access-table">
            <thead><tr><th>{t("客户")}</th><th className="num">{t("余额")}</th><th>{t("权限")}</th></tr></thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td className="c-main">{c.name}{c.contact ? <span className="small muted"> · {c.contact}</span> : null}</td>
                  <td className="num" data-label={t("余额")}>{money(c.balance)}</td>
                  <td data-label={t("权限")}>
                    <select name={`c.${c.id}`} defaultValue={level(c.id)} className={`acc-${level(c.id)}`}>
                      <option value="edit">{t("能操作")}</option>
                      <option value="view">{t("只能看")}</option>
                      <option value="none">{t("看不到")}</option>
                    </select>
                  </td>
                </tr>
              ))}
              {!customers.length && <tr><td colSpan={3} className="muted">{t("还没有客户")}</td></tr>}
            </tbody>
          </table>
        </div>
      </FlashForm>
    </>
  );
}
