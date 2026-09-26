import { redirect } from "next/navigation";

/** 旧地址：改成“联系我们” */
export default function ApplyRedirect() {
  redirect("/site/contact");
}
