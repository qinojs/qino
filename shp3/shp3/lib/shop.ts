import type { App, Db } from "../../../module/core/mod.ts";
import type { Product } from "./rows.ts";

// Db is per App, so this never mixes tenants.
const apps = new WeakMap<Db, App>();

export function bindApp(app: App): void {
  apps.set(app.db, app);
}

export function appOf(db: Db): App {
  const app = apps.get(db);
  if (!app) throw new Error("shp3: module not initialised for this database");
  return app;
}

/** Shop settings, with the defaults the schema declares. */
export const settingsOf = (db: Db) => appOf(db).settings.shp3;

/** Whether product prices already contain VAT. */
export const vatIncluded = async (db: Db): Promise<boolean> => await settingsOf(db).vat.mode !== "excluded";

/** A product is a page that uses the product module, so the row belongs to the page and is created
 *  on demand — a page built in the page tree would otherwise have no product at all. */
export async function ensureProduct(db: Db, id: number | string): Promise<Product | undefined> {
  const table = db.table("shp3_product");
  return await table.get<Product>(id) ?? await table.add<Product>({ id });
}
