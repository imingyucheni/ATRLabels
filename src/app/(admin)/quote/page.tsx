import Link from "next/link";
import { customerChannels, getSettings, listChannels, listCustomers } from "@/lib/db";
import ShipForm from "@/components/ShipForm";
import MultiBoxForm from "@/components/MultiBoxForm";
import { getT } from "@/lib/prefs";
import { currentAdmin } from "@/lib/auth";
import { customerFilter } from "@/lib/adminSession";
import { isMultiBoxName } from "@/lib/multiBox";
import { isDhlCode } from "@/lib/shipbest/dhl";

/**
 * 运费试算（销售用，不出单）：给新客户报价、比较渠道、测试加价幅度。
 * 单个包裹 / 多箱（UPS HWT / FedEx MWT）两种；主管理员和员工都看公司成本和利润。
 */
export default async function QuotePage({ searchParams }: { searchParams: Promise<{ customerId?: string; type?: string }> }) {
  const { customerId, type } = await searchParams;
  const multi = type === "multi";
  // 员工只能选授权给他的客户
  const admin = await currentAdmin();
  const canSee = customerFilter(admin);
  const customers = listCustomers().filter((c) => canSee(c.id));
  const s = getSettings();
  const enabled = listChannels(true);
  const t = await getT();
  const staff = admin?.role === "staff";
  const tab = (to: "single" | "multi") => `?${new URLSearchParams({ ...(to === "multi" ? { type: "multi" } : {}), ...(customerId ? { customerId } : {}) })}`;
  return (
    <>
      <h1>{t("运费试算")}</h1>
      <p className="muted">
        {t("只试算、不出单。可以按新客户临时设的加价试算所有渠道，也可以选已有客户看他实际的价格。")}
        {t("“我们的成本”是公司在服务商的结算价（公司实际付的运费），利润 = 客户价 − 成本（渠道有服务商返利的，利润里含返利）。")}
        {!staff && t("出单在客户自己的 OMS 里进行（需要代客户出单时，在“客户管理”点“进入 OMS”）。")}
      </p>
      <div className="filter-bar">
        <div className="seg">
          <Link href={tab("single")} className={multi ? "" : "on"}>{t("单个包裹")}</Link>
          <Link href={tab("multi")} className={multi ? "on" : ""}>{t("多箱（UPS HWT / FedEx MWT）")}</Link>
        </div>
      </div>
      {!enabled.length && <div className="alert warn">{t("没有启用的渠道，请先到")} <Link href="/settings#shipbest">{t("设置")}</Link> {t("同步渠道。")}</div>}
      {multi ? (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            {t("同一个寄件地址、同一个收件地址的多箱货，一票按总重量计价，比一箱一箱单独寄便宜。按箱规填尺寸、单箱重量和箱数。")}
          </p>
          <MultiBoxForm
            mode="quote"
            customers={customers.map((c) => ({ id: c.id, name: c.name, sender: c.sender ?? null, channels: customerChannels(c.id).filter((ch) => isMultiBoxName(ch.name)).map((ch) => ch.name) }))}
            allChannels={enabled.filter((c) => isMultiBoxName(c.name) && !isDhlCode(c.code)).map((c) => c.name)}
            defaultCustomerId={Number(customerId) || undefined}
            defaultSender={s.sender}
          />
        </>
      ) : (
        <ShipForm
          customers={customers.map((c) => ({ id: c.id, name: c.name, sender: c.sender, channelCount: customerChannels(c.id).length }))}
          defaultCustomerId={Number(customerId) || undefined}
          defaultSender={s.sender}
          defaultUnit={s.defaultUnit}
          defaultCurrency={s.defaultCurrency}
        />
      )}
    </>
  );
}
