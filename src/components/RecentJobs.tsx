import { fmtTime } from "@/lib/time";
import Link from "next/link";
import { JOB_STATUS_LABEL, listJobs } from "@/lib/batch";
import { getT } from "@/lib/prefs";

export default async function RecentJobs({ jobs, basePath, showCustomer }: { jobs: ReturnType<typeof listJobs>; basePath: string; showCustomer?: boolean }) {
  if (!jobs.length) return null;
  const t = await getT();
  return (
    <div className="card table-wrap">
      <h2>{t("最近的批次")}</h2>
      <table>
        <thead><tr>{showCustomer && <th>#</th>}<th>{t("时间")}</th>{showCustomer && <th>{t("客户")}</th>}<th>{t("文件")}</th><th>{t("状态")}</th><th className="num">{t("已下单 / 总数")}</th><th></th></tr></thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              {showCustomer && <td>{j.id}</td>}
              <td className="small muted">{fmtTime(j.created_at)}</td>
              {showCustomer && <td>{j.customer_name}{j.created_by === "customer" && <span className="small muted">{t("（客户自助）")}</span>}</td>}
              <td>{j.filename}</td>
              <td>{t(JOB_STATUS_LABEL[j.status])}</td>
              <td className="num">{j.created} / {j.total}</td>
              <td><Link href={`${basePath}?job=${j.id}`}>{t("查看")}</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
