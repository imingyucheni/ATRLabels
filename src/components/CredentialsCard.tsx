"use client";

import { useState } from "react";

/** 开户信息：一键复制发给客户 */
export default function CredentialsCard(props: { brand: string; name: string; url: string; email: string; password: string; onHide: () => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const text = `您好，${props.name}：
您的 ${props.brand} 账号已开通，可以登录下单、充值和查看记录。
登录地址：${props.url}
登录邮箱：${props.email}
初始密码：${props.password}
登录后请在“账户设置”里修改密码。`;
  return (
    <div className="card cred-card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>开户信息（发给客户）</h2>
        <div className="row">
          <button
            className="primary small"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
              } catch {
                const t = document.createElement("textarea");
                t.value = text;
                document.body.appendChild(t);
                t.select();
                document.execCommand("copy");
                t.remove();
              }
              setCopied(true);
            }}
          >
            {copied ? "已复制 ✓" : "复制开户信息"}
          </button>
          <form action={props.onHide}><button className="small">已发送，隐藏</button></form>
        </div>
      </div>
      <pre className="cred-text">{text}</pre>
      <p className="small muted" style={{ margin: 0 }}>密码只在这里显示 15 分钟（系统只保存加密后的密码）。过期或忘记了，可以在下方“客户端登录”里重新生成。</p>
    </div>
  );
}
