import { Check } from "lucide-react";
import PrefToggles from "./PrefToggles";

/** 登录页布局：左侧品牌区，右侧表单 */
export default function AuthShell({ brand, headline, sub, points, children, showLang = false }: { brand: string; headline: string; sub: string; points: string[]; children: React.ReactNode; showLang?: boolean }) {
  return (
    <div className="auth">
      <div className="auth-side">
        <div className="brand" style={{ padding: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-mark brand-logo" src="/app-icon.svg" alt="" aria-hidden="true" />
          <div className="brand-name">{brand}</div>
        </div>
        <div>
          <h2>{headline}</h2>
          <p>{sub}</p>
          <div className="auth-points">
            {points.map((p) => <div key={p}><Check size={16} strokeWidth={2.2} /> {p}</div>)}
          </div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.5 }}>© {new Date().getFullYear()} {brand}</div>
      </div>
      <div className="auth-main">
        <div className="auth-prefs"><PrefToggles showLang={showLang} /></div>
        {/* 手机上左侧品牌栏隐藏：这里显示 logo 和品牌名 */}
        <div className="auth-mobile-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-mark brand-logo" src="/app-icon.svg" alt="" aria-hidden="true" />
          <b>{brand}</b>
        </div>
        <div className="auth-card">{children}</div>
      </div>
    </div>
  );
}
