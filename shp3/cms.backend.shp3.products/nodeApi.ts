import { ensureProduct } from "@qino/qino/shp3";

import type { Node } from "@qino/qino/cms";

const EDITABLE = new Set(["price", "weight", "stock", "stock_is_fix", "stock_trigger"]);

export default async function (node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (await node.access() < 2) return false;
  const db = node.app.db;

  if ("save" in vars) {
    const field = String(vars.field ?? "");
    if (!EDITABLE.has(field) || !db.table("shp3_product").field(field)) return false; // e.g. stock without shp3.stock
    const page = await node.cms.node(Number(vars.save));
    if (!page.exists() || await page.access() < 2) return false;
    const product = await ensureProduct(page);
    if (!product) return false;
    await product.$set({ [field]: vars.value });
    return { value: product.$get(field) };
  }

  if ("vat" in vars) {
    const data = { product_id: String(vars.vat), country: String(vars.country ?? "").toUpperCase() };
    if (!data.country) return false;
    // An empty rate is not "zero percent", it means "use the shop default".
    if (String(vars.rate ?? "") === "") await db.table("shp3_product_mwst").delete(data);
    else await db.table("shp3_product_mwst").ensure({ ...data, rate: Number(vars.rate) });
    return 1;
  }

  if ("add" in vars) {
    const parent = await node.cms.node(Number(vars.parent));
    if (!parent.exists() || await parent.access() < 2) return false;
    const page = await parent.createChild({ module: String(await node.app.settings.shp3.default_product_module) });
    if (!page.id) return false;
    await page.title(String(vars.lang ?? node.app.languages.def), String(vars.add));
    await ensureProduct(page);
    return { id: page.id };
  }

  if ("delete" in vars) {
    const page = await node.cms.node(Number(vars.delete));
    if (!page.exists() || await page.access() < 3) return false;
    const parent = await page.parent();
    if (!parent) return false;
    await db.table("shp3_product").delete(page.id); // the page removal cascades the rest
    await parent.removeChild(page);
    return 1;
  }

  return false;
}
