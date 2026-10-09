import Link from "next/link";
import FlashForm from "@/components/FlashForm";
import { assignmentsOf, currentAssignment, listSales } from "@/lib/commission";
import { fmtTime } from "@/lib/time";
import { localDate } from "@/lib/reports";
import { getT } from "@/lib/prefs";
import { assignSalesAction, deleteAssignmentAction } from "@/app/commissionActions";

/** 客户详情：归属哪个销售、佣金比例、从哪天起生效（含历史） */
export default async function SalesCard({ customerId }: { customerId: number }) {
  const t = await getT();
  const reps = listSales();
  const history = assignmentsOf(customerId);
  const cur = currentAssignment(customerId);
  const name = (id: number | null) => (id ? reps.find((r) => r.id === id)?.name ?? `#${id}` : t("无销售"));
  const curRep = reps.find((r) => r.id === cur?.salesId);
  return (
    <div className="card" id="sales">
      <div className="card-head">
        <h2 style={{ margin: 0 }}>{t("销售归属（佣金）")}</h2>
        <span className="small muted">
          {curRep
            ? (cur!.rate ?? curRep.rate) === null
              ? t("现在归 {name}，还没设佣金比例", { name: curRep.name })
              : t("现在归 {name}，佣金 {rate}% × 利润", { name: curRep.name, rate: cur!.rate ?? curRep.rate })
            : t("现在没有销售")}
        </span>
      </div>
      {!reps.length ? (
        <p className="small muted">{t("还没有销售。先到")} <Link href="/commissions">{t("销售佣金")}</Link> {t("添加销售。")}</p>
      ) : (
        <FlashForm action={assignSalesAction} submitLabel={history.length ? "保存修改" : "分配销售"} review>
          <input type="hidden" name="customerId" value={customerId} />
          <div className="grid">
            <label className="f">{t("销售")}
              <select name="salesId" defaultValue={cur?.salesId ?? ""}>
                <option value="">{t("无销售")}</option>
                {reps.filter((r) => r.active || r.id === cur?.salesId).map((r) => <option key={r.id} value={r.id}>{r.name}{r.rate !== null ? ` · ${t("默认 {n}%", { n: r.rate })}` : ""}</option>)}
              </select>
            </label>
            <label className="f">{t("这个客户的佣金比例 %")}
              <input name="rate" type="number" min="0" max="100" step="0.01" defaultValue={cur?.rate ?? ""} placeholder={t("例如 5 = 利润的 5%")} />
            </label>
            <fieldset className="f" style={{ border: 0, padding: 0, margin: 0, gridColumn: "1 / -1" }}>
              <span>{t("从哪些订单开始算")}</span>
              <label className="check"><input type="radio" name="scope" value="all" defaultChecked={!history.length} /> {t("这个客户的全部订单（包括以前的）")}</label>
              <label className="check" style={{ alignItems: "center" }}>
                <input type="radio" name="scope" value="from" defaultChecked={history.length > 0} /> {t("从这天起的订单")}
                <input type="date" name="startDate" defaultValue={history.length ? localDate() : ""} style={{ marginLeft: 8, width: 170 }} />
              </label>
            </fieldset>
          </div>
          <p className="small muted">{t("提成 = 这个客户每单的利润 × 比例，每个客户单独设；员工自己开的客户默认归他（按“员工账号”页的默认提成）。选“无销售”，这个客户的利润全部归公司。")} {t("换销售或改比例时选“从这天起”，之前的订单还归原来的销售、按原来的比例；选“全部订单”会把这个客户所有订单都改成新的设置（已经结算的不受影响，多退少补会出现在下次结算里）。")}</p>
        </FlashForm>
      )}
      {history.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="small"><b>{t("归属记录（{n}）", { n: history.length })}</b></summary>
          <table className="list" style={{ marginTop: 6 }}>
            <tbody>
              {[...history].reverse().map((a) => (
                <tr key={a.id}>
                  <td className="small">{a.startDate ? t("{d} 起", { d: a.startDate }) : t("全部订单")}</td>
                  <td className="small"><b>{name(a.salesId)}</b>{a.salesId ? ` · ${a.rate === null ? t("默认比例") : `${a.rate}%`}` : ""}</td>
                  <td className="small muted">{fmtTime(a.createdAt)}</td>
                  <td className="small">
                    <FlashForm action={deleteAssignmentAction} submitLabel="删除" submitClass="small danger" inline confirm={t("删除这条归属记录？对应日期的订单会按前一条记录计算。")}>
                      <input type="hidden" name="customerId" value={customerId} />
                      <input type="hidden" name="id" value={a.id} />
                    </FlashForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
