import Link from "next/link";
import { JOB_STATUS_LABEL, listJobs } from "@/lib/batch";

export default function RecentJobs({ jobs, basePath, showCustomer }: { jobs: ReturnType<typeof listJobs>; basePath: string; showCustomer?: boolean }) {
  if (!jobs.length) return null;
  return (
    <div className="card table-wrap">
      <h2>最近的批次</h2>
      <table>
        <thead><tr><th>#</th><th>时间</th>{showCustomer && <th>客户</th>}<th>文件</th><th>状态</th><th className="num">已下单 / 总数</th><th></th></tr></thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>{j.id}</td>
              <td className="small muted">{j.created_at}</td>
              {showCustomer && <td>{j.customer_name}{j.created_by === "customer" && <span className="small muted">（客户自助）</span>}</td>}
              <td>{j.filename}</td>
              <td>{JOB_STATUS_LABEL[j.status]}</td>
              <td className="num">{j.created} / {j.total}</td>
              <td><Link href={`${basePath}?job=${j.id}`}>查看</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
