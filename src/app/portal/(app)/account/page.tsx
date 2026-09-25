import { requireCustomer } from "@/lib/auth";
import FlashForm from "@/components/FlashForm";
import SenderBook from "@/components/SenderBook";
import { listSenders } from "@/lib/senders";
import { portalChangePasswordAction } from "@/app/portal/actions";

export default async function PortalAccount() {
  const me = await requireCustomer();
  return (
    <>
      <h1>账户设置</h1>
      <div className="card">
        <dl className="kv">
          <dt>公司 / 名称</dt><dd>{me.name}</dd>
          <dt>登录邮箱</dt><dd>{me.portalEmail}</dd>
        </dl>
      </div>
      <SenderBook initial={listSenders(me.id)} />
      <FlashForm action={portalChangePasswordAction} submitLabel="修改密码" className="card" resetOnSuccess>
        <h2>修改密码</h2>
        <div className="grid" style={{ marginBottom: 12 }}>
          <label className="f">当前密码<input type="password" name="current" required autoComplete="current-password" /></label>
          <label className="f">新密码（至少 8 位）<input type="password" name="next" required minLength={8} autoComplete="new-password" /></label>
          <label className="f">确认新密码<input type="password" name="confirm" required minLength={8} autoComplete="new-password" /></label>
        </div>
      </FlashForm>
    </>
  );
}
