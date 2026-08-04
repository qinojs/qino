// The shop of one app: everything that needs its settings or events hangs here — like mail(app)
// and ai(app). What gets by with its arguments stays a free function (ensureProduct, cart).

import { $item, type App, Db, Emitter, itemReadDeep, type ItemProxy } from "../../../module/core/mod.ts";
import type { Currency, GeneratedItem, Order, OrderItem, Product } from "./rows.ts";

export type MethodKind = "payments" | "shippings";

type Errors = Record<string, string>;
type PricePhase = "initial" | "additions" | "discount" | "final";

/** What the shop announces. Listen with `shp3(app).on(...)`, not on the app. */
export type Shp3Events =
  & { [K in PricePhase as `price-${K}`]: { product: Product; price: number; quantity?: number; country?: string; currency?: Currency; config?: unknown; grps?: number[]; time: number } }
  & {
    "product-check": { product: Product; errors: Errors };
    "item-title": { product: Product; title: string };
    "item-description": { item: OrderItem; description: string };
    "item-quantity": { item: OrderItem; quantity: number };
    "item-weight": { item: OrderItem; weight: number };
    "item-check": { item: OrderItem; errors: Errors };
    "payments": { order: Order; payments: Record<string, string> };
    "shippings": { order: Order; shippings: Record<string, string> };
    "shipping-cost": { order: Order; shipping: string; cost: number };
    "generated-items": { order: Order; items: GeneratedItem[] };
    "order-check": { order: Order; errors: Errors };
    "order-try": { order: Order; prevent: boolean };
    "ordered": { order: Order };
    "ordered-after": { order: Order };
    "paid": { order: Order; value: number };
  };
type Method = { enabled?: boolean; description?: string; sort?: number };

const instances = new WeakMap<App, Shp3>();
const byDb = new WeakMap<Db, Shp3>(); // Db is per App, so this never mixes tenants

export class Shp3 extends Emitter<Shp3Events> {
  #app: App;

  constructor(app: App) {
    super();
    this.#app = app;
  }
  get app(): App { return this.#app; }
  get db(): Db { return this.#app.db; }
  /** Shop settings, with the defaults the schema declares. */
  get settings(): ItemProxy { return this.#app.settings.shp3; }

  /** Whether product prices already contain VAT. */
  async vatIncluded(): Promise<boolean> { return await this.settings.vat.mode !== "excluded"; }

  /* Countries — the list belongs to locale.country, a shop only marks the rows it wants. */

  /** The countries the shop delivers to — every one of them while it has marked none. */
  async countries(): Promise<string[]> {
    const enabled = await this.db.col<string>`SELECT id FROM country WHERE shp3_enabled = ${true} ORDER BY id`;
    return enabled.length ? enabled : await this.db.col<string>`SELECT id FROM country ORDER BY id`;
  }

  /** Whether the shop delivers there — an address the customer typed has to pass this. */
  async sellsTo(id: string): Promise<boolean> {
    return (await this.countries()).includes(id);
  }

  /** Where the shop stands. Prices are calculated for it until the customer names a country.
   *  Only a marked country stands in for the setting — the full list is alphabetical, not a location. */
  async country(): Promise<string> {
    return String(await this.settings.location.country ?? "") ||
      await this.db.one<string>`SELECT id FROM country WHERE shp3_enabled = ${true} ORDER BY id LIMIT 1` || "";
  }

  /** The VAT rate of a country, the shop's own location when none is given. */
  async vatRate(id: string): Promise<number> {
    const country = id || await this.country();
    if (!country) return 0;
    return Number(await this.db.one`SELECT shp3_default_vat_rate FROM country WHERE id = ${country}` ?? 0);
  }

  /* Currencies — the shop prices in its own (shp3_currency), the world's rates live in locale.currency. */

  /** The shop's own currency. Nobody marked one as main? Then the first active one has to do. */
  async mainCurrency(): Promise<Currency | undefined> {
    return (await this.db.table("shp3_currency").all<Currency>`WHERE active = ${true} ORDER BY main DESC LIMIT 1`)[0];
  }

  /** Take the shop's factors from fresh reference rates, relative to its main currency (the yardstick at 1). */
  async syncFactors(): Promise<void> {
    const main = await this.mainCurrency();
    if (!main) return;
    const rates = new Map<string, number>();
    for (const row of await this.db.query`SELECT id, rate_to_usd FROM currency WHERE rate_to_usd IS NOT NULL`) {
      rates.set(String(row.id), Number(row.rate_to_usd));
    }
    const base = rates.get(main.$id);
    if (!base) return; // the main currency has no rate — nothing to relate the others to
    for (const row of await this.db.table("shp3_currency").all<Currency>``) {
      const rate = rates.get(row.$id);
      if (rate) row.factor = row.$id === main.$id ? 1 : rate / base;
    }
  }

  /* Payment and shipping methods are settings, not code: a module announces itself once,
     the shop admin enables, describes and sorts it. Same tree as the PHP original. */

  /** The enabled methods of a kind, in their configured order: name → label. */
  async methods(kind: MethodKind): Promise<Record<string, string>> {
    const all = (await itemReadDeep(this.settings[kind][$item]) ?? {}) as Record<string, Method>;
    return Object.fromEntries(
      Object.entries(all)
        .filter(([, m]) => m?.enabled ?? true) // a hand-added entry without the flag counts as on
        .sort((a, b) => Number(a[1]?.sort ?? 0) - Number(b[1]?.sort ?? 0))
        .map(([name, m]) => [name, m?.description || name]),
    );
  }

  /** Announce a method once. Existing settings are never overwritten — they belong to the shop.
   *  Both keys are written, like the PHP install did: a schema default is invisible until the row
   *  exists, and the shop has to see the method in its settings to switch it off. */
  async registerMethod(kind: MethodKind, name: string, description: string): Promise<void> {
    const setting = this.settings[kind][name];
    if (await setting.description !== undefined) return;
    await setting.description(description);
    await setting.enabled("1");
  }

  /** Pick the method to use: the chosen one, the only one, or the first — per setting. */
  async pick(kind: MethodKind, chosen: string, all: Record<string, string>): Promise<string> {
    const names = Object.keys(all);
    if (names.length === 1) return names[0];
    if (chosen && chosen in all) return chosen;
    const auto = await this.settings[kind === "payments" ? "auto_select_payment" : "auto_select_shipping"];
    return auto ? names[0] ?? "" : "";
  }
}

/** The shop of an app — or of its db, which is what the row layer holds. Throws when shp3 is not loaded. */
export function shp3(owner: App | Db): Shp3 {
  const shop = shp3.get(owner);
  if (!shop) throw new Error('module "shp3" is not loaded');
  return shop;
}

/** Undefined when shp3 is not loaded — for optional dependencies. */
shp3.get = (owner: App | Db): Shp3 | undefined => owner instanceof Db ? byDb.get(owner) : instances.get(owner);

/** Bind the shop to its app; the plugin does this once per app. */
export function bindApp(app: App): Shp3 {
  const shop = new Shp3(app);
  instances.set(app, shop);
  byDb.set(app.db, shop);
  return shop;
}
