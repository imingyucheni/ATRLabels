/** 发邮件（SMTP）：后台“设置 → 邮件通知”里填写，没填时用环境变量 SMTP_* */
import nodemailer from "nodemailer";
import { getSettings } from "./db";

export function smtpConfig() {
  const s = getSettings().smtp ?? { host: "", port: 465, user: "", pass: "", from: "" };
  return {
    host: s.host || process.env.SMTP_HOST || "",
    port: Number(s.port || process.env.SMTP_PORT || 465),
    user: s.user || process.env.SMTP_USER || "",
    pass: s.pass || process.env.SMTP_PASS || "",
    from: s.from || process.env.SMTP_FROM || "",
  };
}

export function smtpConfigured() {
  const c = smtpConfig();
  return !!(c.host && c.from);
}

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  // 沙盒站的客户资料是从正式站复制的真实邮箱：测试时一律不发邮件，免得打扰客户
  if (process.env.APP_ENV === "sandbox") throw new Error("沙盒站不发送邮件（避免测试时打扰真实客户）");
  const c = smtpConfig();
  if (!c.host || !c.from) throw new Error("还没有配置发件邮箱（SMTP）");
  const t = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    connectionTimeout: 15_000,
  });
  await t.sendMail({ from: c.from, to, subject, text, ...(html ? { html } : {}) });
}
