import { Check } from "lucide-react";

/** 登录页布局：左侧品牌区，右侧表单 */
export default function AuthShell({ brand, headline, sub, points, children }: { brand: string; headline: string; sub: string; points: string[]; children: React.ReactNode }) {
  const initials = brand.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || brand.slice(0, 2);
  return (
    <div className="auth">
      <div className="auth-side">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark">{initials}</div>
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
        <div className="auth-card">{children}</div>
      </div>
    </div>
  );
}
