"use client";

import { useState, useTransition } from "react";
import { createApiKeyAction } from "@/app/portal/actions";
import { useT } from "@/components/I18n";
import CopyText from "@/components/CopyText";

/** 生成 API 密钥：生成后只显示这一次 */
export default function ApiKeyCreate() {
  const t = useT();
  const [mode, setMode] = useState<"test" | "live">("test");
  const [name, setName] = useState("");
  const [ips, setIps] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (token) {
    return (
      <div className="alert ok">
        <b>{t("密钥已生成，请马上复制保存")}</b>
        <p className="small" style={{ margin: "4px 0 8px" }}>{t("离开这个页面后就再也看不到完整密钥了；丢了只能作废重新生成。不要发到聊天群或写进前端代码。")}</p>
        <CopyText text={token} label="复制密钥" />
        <button type="button" className="small" style={{ marginTop: 8 }} onClick={() => { setToken(null); setName(""); setIps(""); }}>{t("我已保存好")}</button>
      </div>
    );
  }
  return (
    <div>
      <div className="grid">
        <label className="f">{t("类型")}
          <select value={mode} onChange={(e) => setMode(e.target.value as "test" | "live")}>
            <option value="test">{t("测试密钥（模拟出单，不扣钱）")}</option>
            <option value="live">{t("正式密钥（真实出单，从余额扣费）")}</option>
          </select>
        </label>
        <label className="f">{t("名称（方便区分，例如“领星”）")}
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <label className="f" style={{ gridColumn: "1 / -1" }}>{t("IP 白名单（可选，只允许这些 IP 调用，多个用逗号分隔）")}
          <input value={ips} onChange={(e) => setIps(e.target.value)} placeholder="203.0.113.10, 203.0.113.11" />
        </label>
      </div>
      {error && <div className="alert err" style={{ marginTop: 10 }}>{error}</div>}
      <button
        type="button"
        className="primary"
        style={{ marginTop: 12 }}
        disabled={busy}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await createApiKeyAction({ name, mode, ipAllow: ips });
            if (r.error) setError(r.error);
            else setToken(r.token!);
          });
        }}
      >
        {busy ? t("生成中…") : t("生成密钥")}
      </button>
    </div>
  );
}
