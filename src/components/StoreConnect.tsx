"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Plus, RefreshCw, Store as StoreIcon } from "lucide-react";
import FlashForm from "@/components/FlashForm";
import { useT } from "@/components/I18n";
import { deleteMyStoreAction, disconnectMyStoreAction, saveMyShopifyStoreAction, syncMyStoresAction } from "@/app/portal/actions";

export interface StoreCardView {
  id: number;
  platform: "shopify" | "ebay";
  name: string;
  shop: string;
  status: "pending" | "connected" | "error" | "disconnected";
  lastSync: string | null;
  lastError: string | null;
  openCount: number;
  hasSecret: boolean;
  /** 我们替客户开通时生成的 Shopify 安装链接 */
  installUrl: string | null;
  clientId: string | null;
}

const SCOPES = "read_orders, read_merchant_managed_fulfillment_orders, write_merchant_managed_fulfillment_orders";

function Copy({ value }: { value: string }) {
  const t = useT();
  const [ok, setOk] = useState(false);
  return (
    <div className="copy-line">
      <code>{value}</code>
      <button
        type="button"
        className="small"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
          } catch {
            const ta = document.createElement("textarea");
            ta.value = value;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
          }
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        }}
      >
        {ok ? t("已复制 ✓") : t("复制")}
      </button>
    </div>
  );
}

/** 店铺订单页顶部：已连接的店铺 + 连接新店铺（eBay 一键授权，Shopify 三步向导） */
export default function StoreConnect({ stores, base, ebayOn, mock, contact }: { stores: StoreCardView[]; base: string; ebayOn: boolean; mock: boolean; contact?: string }) {
  const t = useT();
  const [picking, setPicking] = useState(stores.length === 0);
  const [wizard, setWizard] = useState<StoreCardView | "new" | null>(null);
  const connected = stores.filter((s) => s.status === "connected");

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>{t("我的店铺")}</h2>
        <div className="row">
          {connected.length > 0 && <FlashForm action={syncMyStoresAction} submitLabel="立即同步订单" submitClass="" inline />}
          {stores.length > 0 && (
            <button type="button" className={picking ? "" : "primary"} onClick={() => setPicking((v) => !v)}>
              <Plus size={15} /> {t("连接店铺")}
            </button>
          )}
        </div>
      </div>

      {stores.length === 0 && (
        <ol className="store-steps">
          <li><b>{t("连接店铺")}</b><span>{t("授权一次就好，之后店里的新订单每 15 分钟自动同步过来")}</span></li>
          <li><b>{t("勾选订单，导入下单")}</b><span>{t("收件地址、SKU 自动带入，选好包裹尺寸就能批量比价出单")}</span></li>
          <li><b>{t("运单号自动回传")}</b><span>{t("出单后自动标记店铺订单为已发货，平台会通知买家")}</span></li>
        </ol>
      )}

      {stores.length > 0 && (
        <div className="store-grid">
          {stores.map((s) => (
            <div key={s.id} className={`store-card ${s.status}`}>
              <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                <span className={`plat ${s.platform}`}>{s.platform === "shopify" ? "Shopify" : "eBay"}</span>
                {s.status === "connected" ? <span className="badge ok">{t("已连接")}</span>
                  : s.status === "pending" ? <span className="badge pending">{t("待完成授权")}</span>
                  : s.status === "error" ? <span className="badge exception">{t("连接出错")}</span>
                  : <span className="badge">{t("已断开")}</span>}
              </div>
              <div className="store-name">{s.name}</div>
              {s.platform === "shopify" && s.name !== s.shop && <div className="small muted">{s.shop}</div>}
              <div className="small muted">
                {s.status === "connected"
                  ? <>{t("待处理订单")} <b className="store-count">{s.openCount}</b> · {s.lastSync ? t("{time} 同步", { time: s.lastSync }) : t("还没同步")}</>
                  : s.status === "pending"
                    ? (s.installUrl ? t("我们已经为你开通好了：点“去 Shopify 安装”，在 Shopify 里点 Install 就完成连接") : t("还差一步：完成授权后开始同步订单"))
                    : t("不会同步订单、不会回传运单号")}
              </div>
              {s.lastError && <div className="small" style={{ color: "var(--err)" }}>{s.lastError}</div>}
              <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {s.platform === "shopify" && s.status !== "connected" && s.installUrl && (
                  <a className="btn small primary" href={s.installUrl}>{t("去 Shopify 安装")} <ExternalLink size={13} /></a>
                )}
                {s.platform === "shopify" && s.status !== "connected" && !s.installUrl && (
                  s.hasSecret
                    ? <a className="btn small primary" href={`/api/stores/shopify/connect?store=${s.id}`}>{s.status === "pending" ? t("去授权") : t("重新授权")}</a>
                    : <button type="button" className="small primary" onClick={() => setWizard(s)}>{t("继续设置")}</button>
                )}
                {s.platform === "shopify" && s.status !== "connected" && s.hasSecret && !s.installUrl && (
                  <button type="button" className="small" onClick={() => setWizard(s)}>{t("修改设置")}</button>
                )}
                {s.platform === "ebay" && s.status !== "connected" && ebayOn && <a className="btn small primary" href="/api/stores/ebay/connect">{t("重新授权")}</a>}
                {s.status === "connected" && (
                  <FlashForm action={disconnectMyStoreAction} submitLabel="断开" submitClass="small" inline confirm="断开后不再同步这个店铺的订单，也不会回传运单号。确定断开吗？">
                    <input type="hidden" name="id" value={s.id} />
                  </FlashForm>
                )}
                {s.status !== "connected" && (
                  <FlashForm action={deleteMyStoreAction} submitLabel="删除" submitClass="small" inline confirm="删除这个店铺和同步下来的订单记录？已出的面单不受影响。">
                    <input type="hidden" name="id" value={s.id} />
                  </FlashForm>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {picking && (
        <div className="plat-pick">
          <div className="plat-tile static">
            <span className="plat shopify">Shopify</span>
            <b>{t("连接 Shopify 店铺")}</b>
            <span className="small">
              {t("联系客服开通（推荐）：告诉我们你的店铺地址（xxx.myshopify.com），我们开通后这里会出现“去 Shopify 安装”按钮，点一下就连上。")}
              {contact ? <> {t("客服：")}<b>{contact}</b></> : null}
            </span>
            <button type="button" className="link-btn small" onClick={() => setWizard("new")}>{t("我会自己设置（约 5 分钟）→")}</button>
          </div>
          {ebayOn ? (
            <a className="plat-tile" href="/api/stores/ebay/connect">
              <span className="plat ebay">eBay</span>
              <b>{t("连接 eBay 店铺")} <ExternalLink size={13} /></b>
              <span className="small muted">{t("一键跳到 eBay 登录授权，授权完自动回来")}</span>
            </a>
          ) : (
            <div className="plat-tile off">
              <span className="plat ebay">eBay</span>
              <b>{t("连接 eBay 店铺")}</b>
              <span className="small muted">{t("暂未开通，请联系客服")}</span>
            </div>
          )}
        </div>
      )}

      {wizard && <ShopifyWizard store={wizard === "new" ? null : wizard} base={base} mock={mock} onClose={() => setWizard(null)} />}
    </div>
  );
}

/** Shopify 三步向导：店铺地址 → 在 Shopify 建应用（复制网址）→ 粘贴 Client ID / Secret 去授权 */
function ShopifyWizard({ store, base, mock, onClose }: { store: StoreCardView | null; base: string; mock: boolean; onClose: () => void }) {
  const t = useT();
  const [step, setStep] = useState(store ? 2 : 1);
  const [shop, setShop] = useState(store?.shop ?? "");
  const [clientId, setClientId] = useState(store?.clientId ?? "");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const handle = shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\.myshopify\.com.*$/, "").replace(/[^a-z0-9-]/g, "");
  const shopOk = /^[a-z0-9][a-z0-9-]*$/.test(handle);
  const demo = mock && handle === "atr-demo";

  function submit() {
    setError(null);
    start(async () => {
      const r = await saveMyShopifyStoreAction({ id: store?.id, shop: `${handle}.myshopify.com`, clientId, clientSecret: secret });
      if (r.error) return setError(r.error);
      window.location.href = r.next!;
    });
  }

  return (
    <div className="modal-back" role="presentation" onClick={() => !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("连接 Shopify 店铺")} onClick={(e) => e.stopPropagation()} style={{ width: "min(680px, 100%)" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}><StoreIcon size={18} /> {t("连接 Shopify 店铺")}</h2>
          <button type="button" className="small" onClick={onClose} disabled={busy}>{t("关闭")}</button>
        </div>
        <div className="wiz-steps">
          {[t("店铺地址"), t("在 Shopify 建应用"), t("粘贴密钥并授权")].map((x, i) => (
            <span key={i} className={step === i + 1 ? "on" : step > i + 1 ? "done" : ""}>{i + 1}. {x}</span>
          ))}
        </div>

        {step === 1 && (
          <>
            <label className="f">{t("你的 Shopify 店铺地址")}
              <div className="row" style={{ gap: 0, flexWrap: "nowrap" }}>
                <input value={shop} onChange={(e) => setShop(e.target.value)} placeholder="your-store" autoFocus style={{ flex: 1, minWidth: 0 }} />
                <span className="muted" style={{ padding: "0 8px" }}>.myshopify.com</span>
              </div>
            </label>
            <p className="small muted">{t("登录 Shopify 后台，浏览器地址里 admin.shopify.com/store/ 后面那一段就是；也可以在“设置 → 域名”里看到 xxx.myshopify.com。")}</p>
            {mock && <p className="small muted">{t("演示模式：填 {shop} 可以直接连上模拟店铺。", { shop: "atr-demo" })}</p>}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="primary" disabled={!shopOk} onClick={() => setStep(demo ? 3 : 2)}>{t("下一步")}</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <ol className="wiz-list">
              <li>
                {t("打开 Shopify 后台的应用开发页面，点“创建应用”（名称随意，例如 ATRShip 发货）：")}
                <div><a className="btn small" href={`https://admin.shopify.com/store/${handle}/settings/apps/development`} target="_blank" rel="noreferrer">{t("打开 Shopify 应用开发")} <ExternalLink size={13} /></a></div>
              </li>
              <li>{t("应用网址（App URL）填：")}<Copy value={`${base}/api/stores/shopify/launch`} /></li>
              <li>{t("重定向网址（Redirect URL）填：")}<Copy value={`${base}/api/stores/shopify/callback`} /></li>
              <li>{t("权限（Access scopes）填：")}<Copy value={SCOPES} /></li>
              <li>{t("如果有“嵌入 Shopify 后台（Embed app in Shopify admin）”选项，取消勾选。")}</li>
              <li>{t("保存并发布版本（Release），然后在应用的“设置”里找到 Client ID 和 Client Secret，下一步要用。")}</li>
            </ol>
            <p className="small muted">{t("只读订单、写入发货信息，不会改动商品、价格和付款。随时可以在 Shopify 里删除这个应用来取消授权。")}</p>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <button type="button" onClick={() => setStep(1)} disabled={!!store}>{t("上一步")}</button>
              <button type="button" className="primary" onClick={() => setStep(3)}>{t("已建好，下一步")}</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <p className="small">{t("店铺：")}<b>{handle}.myshopify.com</b></p>
            <div className="grid">
              <label className="f">Client ID<input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" placeholder={demo ? t("演示店铺可以不填") : ""} /></label>
              <label className="f">Client Secret
                <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" placeholder={store?.hasSecret ? t("已保存，留空不修改") : demo ? t("演示店铺可以不填") : ""} />
              </label>
            </div>
            <p className="small muted">{t("点下面的按钮会跳到 Shopify 让你确认授权，确认后自动回到这里并开始同步订单。密钥只保存在我们服务器上，不会显示给任何人。")}</p>
            {error && <div className="alert err">{error}</div>}
            <div className="row" style={{ justifyContent: "space-between" }}>
              <button type="button" onClick={() => setStep(demo ? 1 : 2)} disabled={busy}>{t("上一步")}</button>
              <button type="button" className="primary" disabled={busy || (!demo && (!clientId.trim() || (!secret.trim() && !store?.hasSecret)))} onClick={submit}>
                {busy ? <><RefreshCw size={14} className="spin" /> {t("保存中…")}</> : demo ? t("连接演示店铺") : t("保存并去 Shopify 授权")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
