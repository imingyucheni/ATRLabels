import Link from "next/link";
import FlashForm from "@/components/FlashForm";
import { setMultiEnabledAction } from "@/app/actions";
import { customerChannels } from "@/lib/db";
import { isMultiBoxName } from "@/lib/multiBox";
import { multiEnabled } from "@/lib/multiAccess";
import { getT } from "@/lib/prefs";

/** 客户详情 → 渠道与价格：多箱寄出（UPS HWT / FedEx MWT）开放给这个客户 */
export default async function MultiAccessCard({ customerId }: { customerId: number }) {
  const t = await getT();
  const on = multiEnabled(customerId);
  const chans = customerChannels(customerId).filter((c) => isMultiBoxName(c.name));
  return (
    <div className="card" id="multi">
      <h2 style={{ marginTop: 0 }}>{t("多箱寄出")}</h2>
      <FlashForm action={setMultiEnabledAction} submitLabel={on ? "关闭" : "开放给这个客户"} submitClass={on ? "small" : "small primary"} className={`alert ${on ? "ok" : ""}`}
        confirm={on ? "关闭后客户 OMS 里看不到“多箱寄出”，已经下的单不受影响。确定关闭吗？" : undefined}>
        <input type="hidden" name="customerId" value={customerId} />
        <input type="hidden" name="on" value={on ? "0" : "1"} />
        <div style={{ marginBottom: 8 }}>
          {on ? t("已开放：客户 OMS 侧边栏有“多箱寄出”，可以一票多箱寄同一个地址（按总重量计价）。") : t("未开放：客户 OMS 里看不到“多箱寄出”。")}
        </div>
      </FlashForm>
      <p className="small muted" style={{ marginBottom: 0 }}>
        {chans.length
          ? t("已开通的多箱渠道：{list}", { list: chans.map((c) => c.name).join("、") })
          : t("还要在上面“可用渠道”里开通多箱渠道（UPS HWT / FedEx MWT），客户才能下单。")}{" "}
        <Link href="/ship/multi">{t("代客户下多箱单 →")}</Link>
      </p>
    </div>
  );
}
