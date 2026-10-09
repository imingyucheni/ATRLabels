import { requireCustomer } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { listProducts, productSuggestions } from "@/lib/products";
import { unitsOf } from "@/lib/units";
import { getT } from "@/lib/prefs";
import ProductBook from "@/components/ProductBook";

export const dynamic = "force-dynamic";

/** 常用产品：商品信息 + 包裹尺寸重量，下单时选一下就填好 */
export default async function PortalProductsPage() {
  const me = await requireCustomer();
  const t = await getT();
  const u = unitsOf(getSettings().defaultUnit);
  return (
    <>
      <h1>{t("常用产品")}</h1>
      <ProductBook initial={listProducts(me.id)} suggestions={productSuggestions(me.id)} defaultDim={u.dim} defaultWeight={u.weight} />
    </>
  );
}
