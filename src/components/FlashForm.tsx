"use client";

import { useActionState, useEffect, useRef, useState, startTransition } from "react";
import { Lock, PencilLine } from "lucide-react";
import type { FlashState } from "@/app/actions";
import { useT, useTMsg } from "@/components/I18n";

const SYSTEM_VALUES = new Set(["✔ 开", "✘ 关", "（新密码 / 新 Token）"]);

type Change = { label: string; from: string; to: string; hint?: string };
type Snap = Map<string, { label: string; value: string; hint?: string }>;

/**
 * 表单里每个字段当前“显示给人看”的值（下拉框取选项文字，勾选框显示开 / 关，密码不显示内容）。
 * 同名的一组勾选框（例如 name="channels" 的每个渠道）按 name=value 分别记录，否则只会记住最后一个；
 * 单选框一组只记选中的那个，按 name 记录。
 */
function snapshot(form: HTMLFormElement): Snap {
  const out: Snap = new Map();
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    if (!el.name || el.type === "hidden" || el.type === "submit" || el.type === "button") continue;
    let value: string;
    let key = el.name;
    if (el instanceof HTMLSelectElement) value = el.selectedOptions[0]?.textContent?.trim() ?? "";
    else if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      if (el.type === "radio" && !el.checked) continue;
      if (el.type === "checkbox") key = `${el.name}=${el.value}`;
      value = el.type === "radio" ? el.value : el.checked ? "✔ 开" : "✘ 关";
    } else if (el.type === "file") value = (el as HTMLInputElement).files?.[0]?.name ?? "";
    else if (el.type === "password") value = el.value ? "（新密码 / 新 Token）" : "";
    else value = el.value.trim();
    // 留空时沿用的默认值通常写在浅灰色提示里（例如“默认 5”），确认时一起显示
    const hint = el instanceof HTMLSelectElement ? undefined : el.placeholder?.trim() || undefined;
    out.set(key, { label: el instanceof HTMLInputElement && el.type === "checkbox" ? checkLabel(el) : fieldLabel(el), value, hint });
  }
  return out;
}

/** 勾选框的名字：勾选卡片里取主标题（<b>），否则按普通字段取 */
function checkLabel(el: HTMLInputElement): string {
  const b = el.closest("label")?.querySelector("b")?.textContent?.trim();
  return b ? b.replace(/\s+/g, " ") : fieldLabel(el);
}

/** 字段的中文名：优先取所在 <label> 的文字；表格里取“行名 · 列名” */
function fieldLabel(el: HTMLElement): string {
  const lab = el.closest("label");
  if (lab) {
    const own = Array.from(lab.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE || (n instanceof HTMLElement && n.tagName === "SPAN" && !n.classList.contains("field-hint")))
      .map((n) => n.textContent ?? "")
      .join("")
      .trim();
    if (own) return own.replace(/\s+/g, " ");
  }
  const td = el.closest("td");
  const tr = td?.parentElement;
  const table = td?.closest("table");
  if (td && tr && table) {
    const idx = Array.from(tr.children).indexOf(td);
    const col = table.querySelectorAll("thead th")[idx]?.textContent?.trim() ?? "";
    const row = Array.from(tr.children).find((c, i) => i !== idx && c.textContent?.trim())?.childNodes[0]?.textContent?.trim() ?? "";
    return [row, col].filter(Boolean).join(" · ");
  }
  return el.getAttribute("aria-label") || el.getAttribute("placeholder") || (el as HTMLInputElement).name;
}

function diff(before: Snap, after: Snap): Change[] {
  const out: Change[] = [];
  for (const [k, a] of after) {
    const b = before.get(k);
    if ((b?.value ?? "") !== a.value) out.push({ label: a.label, from: b?.value ?? "", to: a.value, hint: a.hint });
  }
  return out;
}

/**
 * 通用表单：提交 Server Action 并显示成功/失败提示。
 * 不用 <form action>，避免 React 提交后自动清空表单（出错时用户输入会丢失）；
 * 需要成功后清空的表单（充值金额、密码）传 resetOnSuccess。
 * 重要设置传 review：保存前列出改了哪些项（原值 → 新值）让人确认；没改动就不提交。
 * 影响全部客户的设置传 locked：默认只读，点“修改”才能编辑（自带 review），保存成功后重新锁上。
 */
export default function FlashForm({
  action,
  children,
  submitLabel,
  className,
  submitClass = "primary",
  confirm,
  inline,
  resetOnSuccess,
  id,
  locked,
  review,
}: {
  action: (state: FlashState, fd: FormData) => Promise<FlashState>;
  children?: React.ReactNode;
  submitLabel: string;
  className?: string;
  submitClass?: string;
  confirm?: string;
  inline?: boolean;
  resetOnSuccess?: boolean;
  id?: string;
  /** 锁定说明（例如“修改会影响所有客户的价格”）；传了就默认锁定 */
  locked?: string;
  /** 保存前列出改动并确认 */
  review?: boolean;
}) {
  const t = useT();
  const tMsg = useTMsg();
  // 系统生成的值（开 / 关、新密码）要翻译，用户填的内容原样显示
  const sys = (v: string) => (SYSTEM_VALUES.has(v) ? t(v) : v);
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState(!locked);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [noChange, setNoChange] = useState(false);
  const base = useRef<Snap | null>(null);
  const reviewing = review || !!locked;

  // 记下“修改前”的值：页面加载时、以及每次保存成功后（页面数据已刷新）
  useEffect(() => {
    if (reviewing && ref.current) base.current = snapshot(ref.current);
  }, [reviewing, state]);

  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
    if (locked && state?.ok) setEditing(false);
  }, [state, resetOnSuccess, locked]);

  const send = () => {
    if (!ref.current) return;
    const fd = new FormData(ref.current);
    setChanges(null);
    startTransition(() => formAction(fd));
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setNoChange(false);
    if (locked && !editing) return;
    if (reviewing && base.current) {
      const c = diff(base.current, snapshot(e.currentTarget));
      if (!c.length) return setNoChange(true);
      return setChanges(c);
    }
    if (confirm && !window.confirm(t(confirm))) return;
    send();
  };

  // 空值：有浅灰色提示（沿用的默认值）时一起显示，例如“（空）· 默认 5”
  const empty = (hint?: string) => (hint ? `${t("（空）")} · ${hint}` : t("（空）"));

  const dialog = changes && (
    <div className="modal-back" role="presentation" onClick={() => setChanges(null)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("确认修改")} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{t("确认修改以下 {n} 项？", { n: changes.length })}</h3>
        {confirm && <div className="alert warn">{t(confirm)}</div>}
        <div className="table-wrap" style={{ maxHeight: "50vh", overflow: "auto" }}>
          <table className="list change-list">
            <thead><tr><th>{t("项目")}</th><th>{t("原来")}</th><th></th><th>{t("改成")}</th></tr></thead>
            <tbody>
              {changes.map((c, i) => (
                <tr key={i}>
                  <td>{c.label}</td>
                  <td className="muted">{c.from ? sys(c.from) : empty(c.hint)}</td>
                  <td className="muted">→</td>
                  <td><b>{c.to ? sys(c.to) : empty(c.hint)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" onClick={() => setChanges(null)}>{t("返回修改")}</button>
          <button type="button" className="primary" autoFocus onClick={send}>{t("确认保存")}</button>
        </div>
      </div>
    </div>
  );

  const alerts = (
    <>
      {state?.ok && <div className="alert ok">{tMsg(state.ok)}</div>}
      {state?.error && <div className="alert err">{tMsg(state.error)}</div>}
      {noChange && <div className="alert warn">{t("没有改动，不需要保存")}</div>}
    </>
  );

  if (locked) {
    return (
      <form ref={ref} id={id} className={`${className ?? ""} locked-form${editing ? " editing" : ""}`} onSubmit={onSubmit}>
        {alerts}
        <fieldset disabled={!editing || pending} className="bare">{children}</fieldset>
        <div className="lock-bar">
          {editing ? (
            <>
              <button className={submitClass} disabled={pending}>{pending ? t("处理中…") : t(submitLabel)}</button>
              <button type="button" disabled={pending} onClick={() => { ref.current?.reset(); setEditing(false); setNoChange(false); }}>{t("取消修改")}</button>
              <span className="small warn-text">{t(locked)}</span>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setEditing(true)}><PencilLine size={14} strokeWidth={2} /> {t("修改")}</button>
              <span className="small muted"><Lock size={12} strokeWidth={2.2} /> {t("已锁定，防止误改")} · {t(locked)}</span>
            </>
          )}
        </div>
        {dialog}
      </form>
    );
  }

  return (
    <form ref={ref} id={id} className={className} style={inline ? { display: "inline-block" } : undefined} onSubmit={onSubmit}>
      {alerts}
      {children}
      <button className={submitClass} disabled={pending}>
        {pending ? t("处理中…") : t(submitLabel)}
      </button>
      {dialog}
    </form>
  );
}
