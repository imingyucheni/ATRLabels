import { redirect } from "next/navigation";

/** 下单在客户 OMS 里进行：后台到“客户”页面点“进入客户 OMS”代客户下单 */
export default function Page() {
  redirect("/quote");
}
