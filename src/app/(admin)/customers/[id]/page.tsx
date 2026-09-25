import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomer, getSettings } from "@/lib/db";
import FlashForm from "@/components/FlashForm";
import RuleInputs from "@/components/RuleInputs";
import { saveCustomerAction } from "@/app/actions";

export default async function CustomerEdit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = id === "new" ? null : getCustomer(Number(id));
  if (id !== "new" && !c) notFound();
  const { markup } = getSettings();
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{c ? `编辑客户：${c.name}` : "新增客户"}</h1>
        <Link href="/customers">← 返回</Link>
      </div>
      <FlashForm action={saveCustomerAction} submitLabel="保存" className="card">
        <input type="hidden" name="id" value={c?.id ?? ""} />
        <div className="grid">
          <label className="f"><span className="req">名称</span><input name="name" required defaultValue={c?.name} /></label>
          <label className="f">联系人<input name="contact" defaultValue={c?.contact ?? ""} /></label>
          <label className="f">电话<input name="phone" defaultValue={c?.phone ?? ""} /></label>
          <label className="f">邮箱<input name="email" type="email" defaultValue={c?.email ?? ""} /></label>
        </div>
        <h3>专属加价（留空 = 沿用渠道 / 全局设置）</h3>
        <div className="grid">
          <RuleInputs value={c?.markup} placeholder={{ percent: `默认 ${markup.percent}`, fixed: `默认 ${markup.fixed}`, minProfit: `默认 ${markup.minProfit}` }} />
        </div>
        <label className="f" style={{ margin: "12px 0" }}>备注<textarea name="note" rows={2} defaultValue={c?.note ?? ""} /></label>
      </FlashForm>
    </>
  );
}
