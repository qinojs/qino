import type { Node } from "../../module/cms/mod.ts";
import { ensureProduct } from "../shp3/mod.ts";

const EDITABLE = new Set(["price", "weight", "stock"]);

export default async function (node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (await node.access() < 2) return false;
  if (!("save" in vars)) return false;
  const field = String(vars.field ?? "");
  if (!EDITABLE.has(field)) return false;
  if (!node.app.db.table("shp3_product").field(field)) return false; // e.g. stock without shp3.stock
  const product = await ensureProduct(node.app.db, vars.save as string);
  if (!product) return false;
  await product.$set({ [field]: vars.value });
  return { value: product.$get(field) };
}
