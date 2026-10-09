"use server";

/** 客户的常用产品（商品信息 + 包裹尺寸重量）：新增、修改、删除 */
import { revalidatePath } from "next/cache";
import { requireCustomer } from "@/lib/auth";
import { deleteProduct, listProducts, saveProduct, type ProductInput, type SavedProduct } from "@/lib/products";
import { tMsg } from "@/lib/prefs";

const refresh = () => {
  for (const p of ["/portal/products", "/portal/ship", "/portal/intl", "/portal/stores"]) revalidatePath(p);
};

export async function saveProductAction(input: Partial<ProductInput>): Promise<{ error?: string; id?: number; products?: SavedProduct[] }> {
  const me = await requireCustomer();
  try {
    const id = saveProduct(me.id, input);
    refresh();
    return { id, products: listProducts(me.id) };
  } catch (e) {
    return { error: await tMsg((e as Error).message) };
  }
}

export async function deleteProductAction(id: number): Promise<{ products: SavedProduct[] }> {
  const me = await requireCustomer();
  deleteProduct(me.id, Number(id));
  refresh();
  return { products: listProducts(me.id) };
}
