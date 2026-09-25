"use client";

import { useState } from "react";
import { useT } from "@/components/I18n";

/** 开户信息：一键复制发给客户 */
export default function CredentialsCard(props: { brand: string; name: string; url: string; email: string; password: string; onHide: () => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const t = useT();
  const text = t("您好，{name}：\n您的 {brand} 账号已开通，可以登录下单、充值和查看记录。\n登录地址：{url}\n登录邮箱：{email}\n初始密码：{password}\n登录后请在“账户设置”里修改密码。", {
    name: props.name,
    brand: props.brand,
    url: props.url,
    email: props.email,
    password: props.password,
  });
  return (
    <div className="card cred-card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{t("开户信息（发给客户）")}</h2>
        <div className="row">
          <button
            className="primary small"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
              } catch {
                const ta = document.createElement("textarea");
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                ta.remove();
              }
              setCopied(true);
            }}
          >
            {copied ? t("已复制 ✓") : t("复制开户信息")}
          </button>
          <form action={props.onHide}><button className="small">{t("已发送，隐藏")}</button></form>
        </div>
      </div>
      <pre className="cred-text">{text}</pre>
      <p className="small muted" style={{ margin: 0 }}>{t("密码只在这里显示 15 分钟（系统只保存加密后的密码）。过期或忘记了，可以在下方“客户端登录”里重新生成。")}</p>
    </div>
  );
}
