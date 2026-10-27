"use client";

import { useState } from "react";
import { useLang, useT } from "@/components/I18n";
import { translate, type Lang } from "@/lib/i18n";

/** 开户信息：一键复制发给客户 */
export default function CredentialsCard(props: { brand: string; name: string; url: string; email: string; password: string; onHide: () => Promise<void>; noChannels?: boolean }) {
  const [copied, setCopied] = useState(false);
  // 密码默认遮住（开放办公室防旁人看到），复制时带完整密码
  const [reveal, setReveal] = useState(false);
  const t = useT();
  // 发给客户的语言和后台界面语言分开选：英文客户发英文版，登录链接带 ?lang=en，打开就是英文界面
  const [lang, setLang] = useState<Lang>(useLang());
  const url = `${props.url}${props.url.includes("?") ? "&" : "?"}lang=${lang}`;
  const text = translate(lang, "您好，{name}：\n您的 {brand} 账号已开通，可以登录下单、充值和查看记录。\n登录地址：{url}\n登录邮箱：{email}\n初始密码：{password}\n登录后请在“账户设置”里修改密码。", {
    name: props.name,
    brand: props.brand,
    url,
    email: props.email,
    password: props.password,
  });
  return (
    <div className="card cred-card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{t("开户信息（发给客户）")}</h2>
        <div className="row">
          <div className="seg" role="group" aria-label={t("发给客户的语言")}>
            {(["zh", "en"] as const).map((l) => (
              <button key={l} type="button" className={`small${lang === l ? " on" : ""}`} aria-pressed={lang === l} onClick={() => { setLang(l); setCopied(false); }}>
                {l === "zh" ? "中文" : "English"}
              </button>
            ))}
          </div>
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
            {copied ? t("已复制 ✓") : lang === "en" ? t("复制英文版") : t("复制开户信息")}
          </button>
          <form action={props.onHide}><button className="small">{t("已发送，隐藏")}</button></form>
        </div>
      </div>
      {/* 没开通渠道的客户登录后什么都下不了单：先提醒开通渠道再发 */}
      {props.noChannels && (
        <div className="alert warn" style={{ margin: "10px 0 0" }}>
          {t("这个客户还没有开通任何渠道，请先在下方“可用渠道”里开通，再把登录信息发给客户。")} <a href="?tab=pricing#channels">{t("去开通渠道 ↓")}</a>
        </div>
      )}
      <pre className="cred-text">{reveal ? text : text.replace(props.password, "••••••••")}</pre>
      <button type="button" className="small" style={{ marginBottom: 8 }} onClick={() => setReveal((v) => !v)}>{reveal ? t("隐藏密码") : t("显示密码")}</button>
      <p className="small muted" style={{ margin: 0 }}>{t("密码只在这里显示 15 分钟（系统只保存加密后的密码）。过期或忘记了，可以在下方“客户端登录”里重新生成。")}</p>
    </div>
  );
}
