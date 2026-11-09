// Shop-wide lookups: countries, tax, currencies. Free functions on the app — rows reach their app
// through the binding below.
import type { App, Db, ItemProxy, Usr } from "@qino/qino";
import type { Currency } from "./rows.ts";

const apps = new WeakMap<Db, App>(); // Db is per App, so this never mixes tenants

/** Bind the shop to its app; the plugin does this once per app. */
export const bind = (app: App): void => void apps.set(app.db, app);

/** The app a shop table belongs to. */
export function appOf(db: Db): App {
  const app = apps.get(db);
  if (!app) throw new Error('module "cms.shop" is not loaded');
  return app;
}

export const settingsOf = (app: App): ItemProxy => app.settings["cms.shop"];

/** The shop's texts: every shop module translates in one namespace, cms.shop (its locale/). */
export const shopT = (app: App) => (strings: TemplateStringsArray, ...values: unknown[]): Promise<string> =>
  app.languages.with({ ns: "cms.shop" }, () => app.t(strings, ...values));

/** Whether product prices contain tax. */
export const taxIncluded = async (app: App): Promise<boolean> => await settingsOf(app).taxIncluded !== false;

/** What every price asks, read once per app and again once its table changed (`forget`). */
const caches = new WeakMap<App, Map<string, Promise<unknown>>>();
function cached<T>(app: App, table: string, load: () => Promise<T>): Promise<T> {
  const tables = caches.getOrInsertComputed(app, () => new Map());
  return tables.getOrInsertComputed(table, load) as Promise<T>;
}
/** The tables behind the caches; a write to one of them (through its table) drops its cache. */
export const CACHED = ["country", "shop_currency", "shop_product_tax"];
export const forget = (app: App, table: string): void => void caches.get(app)?.delete(table);

type Country = { enabled: boolean; rate: number; currency: string };
const countryRows = (app: App) => cached(app, "country", async () => new Map((await app.db.query`
  SELECT id, shop_enabled, shop_tax_rate, shop_currency, currency FROM country ORDER BY id`).map((r) => [String(r.id), {
  enabled: !!Number(r.shop_enabled), rate: Number(r.shop_tax_rate ?? 0), currency: String(r.shop_currency || r.currency || ""),
} as Country])));

/** The countries the shop delivers to — every one of them while it has marked none. */
export async function countries(app: App): Promise<string[]> {
  const rows = await countryRows(app);
  const marked = [...rows].filter(([, c]) => c.enabled).map(([id]) => id);
  return marked.length ? marked : [...rows.keys()];
}

/** Whether the shop delivers there. */
export const sellsTo = async (app: App, country: string): Promise<boolean> => (await countries(app)).includes(country);

/** Where the shop stands: prices are calculated for it until the customer names a country. */
export async function country(app: App): Promise<string> {
  return String(await settingsOf(app).country ?? "") || [...await countryRows(app)].find(([, c]) => c.enabled)?.[0] || "";
}

/** The VAT rate of a country, in percent. */
export async function taxRate(app: App, id: string): Promise<number> {
  return (await countryRows(app)).get(id || await country(app))?.rate ?? 0;
}

/** A product's own VAT rate in a country, if it has one. */
export async function productTaxRate(app: App, productId: unknown, country: string): Promise<number | undefined> {
  const rates = await cached(app, "shop_product_tax", async () => new Map((await app.db.query`
    SELECT product_id, country, rate FROM shop_product_tax`).map((r) => [`${r.product_id}|${r.country}`, Number(r.rate)])));
  return rates.get(`${productId}|${country}`);
}

/** The shop's main currency: the one marked, else the first active one. */
export async function mainCurrency(app: App): Promise<Currency | undefined> {
  const id = await cached(app, "shop_currency", () => app.db.one<string>`SELECT id FROM shop_currency WHERE active = ${true} ORDER BY main DESC, id LIMIT 1`);
  return id ? currency(app, id) : undefined;
}

/** An active currency of the shop. */
export async function currency(app: App, id: string): Promise<Currency | undefined> {
  const found = id ? await app.db.table("shop_currency").get<Currency>(id) : undefined;
  return found?.active ? found : undefined;
}

/** The currency a country pays in: the one the shop assigned, else its own, else the main one. */
export async function currencyFor(app: App, id: string): Promise<Currency | undefined> {
  return await currency(app, (await countryRows(app)).get(id)?.currency ?? "") ?? mainCurrency(app);
}

/** Update the factors from current rates, relative to the main currency (= 1). */
export async function syncFactors(app: App): Promise<void> {
  const main = await mainCurrency(app);
  if (!main) return;
  const rates = new Map<string, number>();
  for (const row of await app.db.query`SELECT id, rate_to_usd FROM currency WHERE rate_to_usd IS NOT NULL`) {
    rates.set(String(row.id), Number(row.rate_to_usd));
  }
  const base = rates.get(main.$id);
  if (!base) return; // the main currency has no rate — nothing to relate the others to
  for (const row of await app.db.table("shop_currency").all<Currency>``) {
    const rate = rates.get(row.$id);
    if (rate) row.factor = row.$id === main.$id ? 1 : rate / base;
  }
}

/** Listen to shop events until the module unlinks: `const on = listen(app, signal)`. The payloads
 *  are declared as data (App.events), so a listener names the fields it reads. */
// deno-lint-ignore no-explicit-any -- see above
export const listen = (app: App, signal: AbortSignal) => (event: string, fn: (e: any) => unknown): void =>
  app.on(event as never, fn as never, { signal });

/** A user's groups (core's Usr.grps, 0 included); none for a guest. */
export async function grpsOf(app: App, usrId: unknown): Promise<number[]> {
  if (!Number(usrId)) return [];
  return await (await app.db.table("usr").get<Usr>(usrId))?.grps() ?? [];
}

/** A configured list (`"weight.a, pickup"`): the names in order, empty when nothing is set. */
export const listOf = async (setting: unknown): Promise<string[]> =>
  String(await setting ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Keep and order what a list names; an empty list keeps everything as it is. */
export function pick<T extends { name: string }>(all: T[], names: string[]): T[] {
  if (!names.length) return all;
  return names.map((name) => all.find((m) => m.name === name)).filter((m): m is T => !!m);
}
