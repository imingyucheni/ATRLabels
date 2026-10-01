import { headers } from "next/headers";
import FlashForm from "@/components/FlashForm";
import PlatformLogo from "@/components/PlatformLogo";
import { listStores, storesEnabled, type StoreConnection } from "@/lib/stores";
import { publicBase } from "@/lib/stores/web";
import { shipbestMode } from "@/lib/shipbest/client";
import { fmtTime } from "@/lib/time";
import { getT } from "@/lib/prefs";
import { removeStoreAdminAction, saveShopifyStoreAction, setStoresEnabledAction, syncStoreAdminAction } from "@/app/actions";

const STATUS: Record<StoreConnection["status"], [string, string]> = {
  connected: ["已连接", "ok"],
  pending: ["待授权", "warn"],
  error: ["出错", "exception"],
  disconnected: ["已断开", ""],
};

/** 后台客户详情：客户的 Shopify / eBay 店铺（Shopify 要按店铺配置自定义 App） */
export default async function StoresCard({ customerId }: { customerId: number }) {
  const t = await getT();
  const stores = listStores(customerId);
  const base = publicBase({ headers: await headers() });
  const mock = shipbestMode() === "mock";
  const on = storesEnabled(customerId);
  const shopifyForm = (s?: StoreConnection) => (
    <FlashForm action={saveShopifyStoreAction} submitLabel={s ? "保存" : "添加 Shopify 店铺"} submitClass={s ? "small" : "primary"}>
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="id" value={s?.id ?? ""} />
      <div className="grid">
        <label className="f"><span className="req">{t("店铺域名")}</span>
          <input name="shop" required defaultValue={s?.shop ?? ""} placeholder="xxx.myshopify.com" readOnly={!!s} /></label>
        <label className="f"><span className="req">Client ID</span><input name="clientId" defaultValue={s?.clientId ?? ""} autoComplete="off" /></label>
        <label className="f">Client Secret
          <input name="clientSecret" type="password" autoComplete="new-password" placeholder={s?.hasSecret ? t("已保存，留空不修改") : ""} /></label>
        <label className="f" style={{ gridColumn: "1 / -1" }}>{t("安装链接（Shopify 自定义分发生成）")}
          <input name="installUrl" type="url" defaultValue={s?.installUrl ?? ""} placeholder="https://admin.shopify.com/…" autoComplete="off" /></label>
      </div>
      {mock && !s && <p className="small muted">{t("演示模式：店铺域名填 {shop}、Client ID 随便填，就能连上模拟店铺。", { shop: "atr-demo.myshopify.com" })}</p>}
    </FlashForm>
  );
  return (
    <div className="card" id="stores">
      <h2 style={{ marginTop: 0 }}>{t("电商店铺")} <span className="badge test">{t("测试中")}</span></h2>
      <FlashForm action={setStoresEnabledAction} submitLabel={on ? "关闭" : "开放给这个客户"} submitClass={on ? "small" : "small primary"} className={`alert ${on ? "ok" : ""}`}
        confirm={on ? "关闭后客户看不到“店铺订单”，已连接的店铺暂停同步订单。确定关闭吗？" : undefined}>
        <input type="hidden" name="customerId" value={customerId} />
        <input type="hidden" name="on" value={on ? "0" : "1"} />
        <div style={{ marginBottom: 8 }}>
          {on
            ? t("已开放：客户 OMS 侧边栏有“店铺订单”，可以自己连接 Shopify / eBay。")
            : t("未开放：这个功能还在测试，客户 OMS 里看不到。先给内部测试账号开放测试，没问题再开放给客户。")}
        </div>
      </FlashForm>
      <p className="small muted">
        {t("客户在客户中心“店铺订单”里自己连接 Shopify / eBay（有分步向导）。这里可以查看连接状态、手动同步，或代客户添加。店铺里未发货的订单每 15 分钟同步一次，出单后运单号自动回传。")}
      </p>
      {stores.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t("平台")}</th><th>{t("店铺")}</th><th>{t("状态")}</th><th>{t("最近同步")}</th><th className="num">{t("待发货")}</th><th></th></tr></thead>
            <tbody>
              {stores.map((s) => {
                const [label, cls] = STATUS[s.status];
                return (
                  <tr key={s.id}>
                    <td><PlatformLogo platform={s.platform} size="sm" /></td>
                    <td><b>{s.name}</b>{s.name !== s.shop && <div className="small muted">{s.shop}</div>}
                      {s.lastError && <div className="small" style={{ color: "var(--err)" }}>{s.lastError}</div>}</td>
                    <td><span className={`badge ${cls}`}>{t(label)}</span></td>
                    <td className="small muted">{s.lastSyncAt ? fmtTime(s.lastSyncAt) : "-"}</td>
                    <td className="num">{s.openCount}</td>
                    <td>
                      <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                        {s.platform === "shopify" && s.status !== "connected" && s.installUrl && (
                          <a className="btn small primary" href={s.installUrl} target="_blank" rel="noreferrer">{t("安装链接")}</a>
                        )}
                        {s.status === "connected" && (
                          <FlashForm action={syncStoreAdminAction} submitLabel="立即同步" submitClass="small" inline>
                            <input type="hidden" name="id" value={s.id} />
                          </FlashForm>
                        )}
                        {s.status !== "disconnected" && (
                          <FlashForm action={removeStoreAdminAction} submitLabel="断开" submitClass="small" inline confirm="断开这个店铺？之后不再同步订单、也不再回传运单号（已同步的订单记录保留）。">
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="mode" value="disconnect" />
                          </FlashForm>
                        )}
                        <FlashForm action={removeStoreAdminAction} submitLabel="删除" submitClass="small danger" inline confirm="删除这个店铺连接和同步下来的订单记录？已出的面单不受影响。">
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="mode" value="delete" />
                        </FlashForm>
                      </div>
                      {s.platform === "shopify" && (
                        <details style={{ marginTop: 6 }}>
                          <summary className="small">{t("修改 App 凭证")}</summary>
                          {shopifyForm(s)}
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <details style={{ marginTop: 12 }}>
        <summary><b>{t("替客户开通 Shopify 店铺（客户只需点一下安装链接）")}</b></summary>
        <ol className="small muted" style={{ lineHeight: 1.8 }}>
          <li>{t("在 dev.shopify.com 点“Create an app”，名称例如“ATRShip 发货 - 客户名”。")}</li>
          <li>{t("App URL 填：")}<code>{`${base}/api/stores/shopify/launch`}</code></li>
          <li>{t("允许的回调网址（Redirect URL）填：")}<code>{`${base}/api/stores/shopify/callback`}</code></li>
          <li>{t("权限（Scopes）：")}<code>read_orders, read_merchant_managed_fulfillment_orders, write_merchant_managed_fulfillment_orders</code>{t("；“嵌入 Shopify 后台”不要勾。保存并发布版本（Release）。")}</li>
          <li>{t("分发方式（Distribution）选“自定义分发（Custom distribution）”，填客户的 xxx.myshopify.com，生成安装链接。")}</li>
          <li>{t("把店铺域名、Client ID、Client Secret 和安装链接填到下面保存，再点上面的“开放给这个客户”。")}</li>
          <li>{t("客户在客户中心“店铺订单”里会看到“去 Shopify 安装”按钮（也可以把安装链接直接发给客户），点 Install 后自动完成连接。")}</li>
        </ol>
        {shopifyForm()}
      </details>
      <p className="small muted" style={{ marginTop: 12 }}>
        {t("eBay 店铺由客户自己在“店铺订单”里一键授权（需要先在“设置 → eBay 店铺对接”里填好我们的 eBay App）。")}
      </p>
    </div>
  );
}
