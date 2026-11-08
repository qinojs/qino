// Row classes of the shop. Columns are data, methods are verbs: `price` is a column, so the
// calculation is `prices()`. Amounts are minor units (fin's rule): 2450 is CHF 24.50.
import { DbRow, sql, unixTime } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { fromMinor } from "@qino/qino/fin";
import { totals } from "@qino/qino/fin.invoice";
import { create as createPayment, methods as finMethods } from "@qino/qino/fin.payment";
import { currency as iso } from "@qino/qino/locale.currency";

import { appOf, country, currency, currencyFor, listOf, mainCurrency, pick, productTaxRate, settingsOf, shopT, taxIncluded, taxRate } from "./shop.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export type Errors = Record<string, string>;
export type Method = { name: string; label: string };
/** A party as fin.invoice takes it, plus how to reach it. */
export type Party = {
  name?: string;
  honorificPrefix?: string;
  givenName?: string;
  familyName?: string;
  organization?: string;
  email?: string;
  telephone?: string;
  address?: Record<string, string>;
};
/** A line the shop adds itself — shipping, a surcharge. Stored as a line once the order is placed. */
export type Extra = { key: string; name: string; price: number; taxRate: number; taxCategory?: string; sort?: number };
export type Status = "cart" | "ordered" | "paid" | "canceled";
/** What a price depends on. Without an order: the shop's own country and main currency. */
export type PriceQuery = {
  variant?: Variant;
  quantity?: number;
  order?: Order;
  currency?: Currency;
  country?: string;
  usrId?: number;
  data?: unknown;
  time?: number;
};

const PHASES = ["initial", "additions", "discount", "final"] as const;
const KEY = sql.id("key"); // a reserved word in MySQL
const json = (value: unknown) => JSON.parse(String(value || "null"));

/** Every shop table lives in one app. */
class ShopRow extends DbRow {
  get $app(): App { return appOf(this.$table.db); }
}

export class Currency extends ShopRow {
  declare id: string;
  declare factor: number;
  declare rounding: number;
  declare active: boolean;
  declare main: boolean;

  /** An amount of the main currency in this one. */
  change(amount: number): number { return amount * this.factor; }
  unchange(amount: number): number { return amount / this.factor; }
  /** To the step reduced prices land on (5: 0.05 CHF). */
  round(amount: number): number { return Math.round(amount / (Number(this.rounding) || 1)) * (Number(this.rounding) || 1); }
  /** "24.50" — as many decimals as the currency has. */
  format(amount: number): string { return fromMinor(Math.round(amount), this.$id).toFixed(iso.decimals(this.$id)); }
  show(amount: number): string { return `${this.$id} ${this.format(amount)}`; }
}

export class Product extends ShopRow {
  declare id: number;
  declare price: number;
  declare weight: number;
  declare length: number;
  declare width: number;
  declare height: number;
  declare sku: string;
  declare gtin: string;
  declare brand: string;

  node(): Promise<Node> { return cms(this.$app).node(Number(this.$id)); }

  /** The page's title, else the id (`page.name` is internal). An untranslated language is empty. */
  async title(lang?: string): Promise<string> {
    const node = await this.node(), def = this.$app.languages.def;
    return String(await node.title(lang || def) || await node.title(def) || this.$id);
  }

  variants(): Promise<Variant[]> {
    return this.$table.db.table("shop_variant").all<Variant>`WHERE product_id = ${this.$id} ORDER BY sort, id`;
  }

  /** One of its own variants — an id from a request never reaches another product's. */
  async variant(id: unknown): Promise<Variant | undefined> {
    const variant = id ? await this.$table.db.table("shop_variant").get<Variant>(id) : undefined;
    return variant && String(variant.product_id) === this.$id ? variant : undefined;
  }

  /** VAT in a country: the product's own rate, else the country's. */
  async taxRate(country: string): Promise<number> {
    return await productTaxRate(this.$app, this.$id, country) ?? taxRate(this.$app, country);
  }

  /** The unit price in four passes — base, surcharges, discounts, rounding. `price` is what a line
   *  stores: gross if prices include tax, else net. */
  async prices(q: PriceQuery = {}): Promise<{ price: number; net: number; gross: number }> {
    const app = this.$app;
    const currency = q.currency ?? await q.order?.currencyRow() ?? await mainCurrency(app);
    const where = q.country ?? q.order?.country ?? await country(app);
    const base = q.variant?.price ?? this.price;
    const e = {
      product: this,
      variant: q.variant,
      price: currency ? currency.change(Number(base)) : Number(base),
      quantity: q.quantity ?? 1,
      order: q.order,
      currency,
      country: where,
      usrId: q.usrId ?? q.order?.usr_id,
      data: q.data,
      time: q.time ?? unixTime(),
    };
    for (const phase of PHASES) await app.fire(`shop:price-${phase}`, e);
    const factor = (await this.taxRate(where)) / 100 + 1;
    return await taxIncluded(app)
      ? { price: e.price, net: e.price / factor, gross: e.price }
      : { price: e.price, net: e.price, gross: e.price * factor };
  }

  /** What keeps it (or a variant of it) out of a cart; empty when it can be sold. */
  async errors(variant?: Variant): Promise<Errors> {
    const e = { product: this, variant, errors: {} as Errors };
    await this.$app.fire("shop:product-check", e);
    return e.errors;
  }
}

export class Variant extends ShopRow {
  declare id: number;
  declare product_id: number;
  declare sort: number;
  declare price: number | null;
  declare weight: number | null;
  declare length: number | null;
  declare width: number | null;
  declare height: number | null;
  declare sku: string;
  declare gtin: string;

  product(): Promise<Product | undefined> { return this.$table.db.table("shop_product").get<Product>(this.product_id); }

  /** Its name is a text of the product's page, `variant_<id>` — read, never created by reading. */
  async title(lang?: string): Promise<string> {
    const node = await (await this.product())?.node();
    const text = (await node?.texts())?.get(`variant_${this.$id}`);
    return text ? text.lang(lang || this.$app.languages.def).get() : "";
  }
}

export class Line extends ShopRow {
  declare id: number;
  declare order_id: number;
  declare sort: number;
  declare key: string;
  declare product_id: number;
  declare variant_id: number | null;
  declare name: string;
  declare description: string;
  declare quantity: number;
  declare price: number;
  declare tax_rate: number;
  declare tax_category: string;
  declare amount: number;
  declare data: string;

  order(): Promise<Order | undefined> { return this.$table.db.table("shop_order").get<Order>(this.order_id); }
  product(): Promise<Product | undefined> { return this.$table.db.table("shop_product").get<Product>(this.product_id); }
  async variant(): Promise<Variant | undefined> { return (await this.product())?.variant(this.variant_id); }
  dataOf(): unknown { return json(this.data); }

  /** Frozen once the order is placed, live before. */
  async taxRate(): Promise<number> {
    const order = await this.order();
    if (!order || order.status !== "cart") return Number(this.tax_rate);
    return await (await this.product())?.taxRate(order.country) ?? 0;
  }

  /** What the customer reads below the name: the variant, a discount … Frozen once placed. */
  async describe(): Promise<string> {
    const order = await this.order();
    if (order?.status !== "cart") return String(this.description ?? "");
    const variant = await this.variant();
    const e = { line: this, description: variant ? await variant.title(order.lang) : "" };
    await this.$app.fire("shop:line-description", e);
    return e.description;
  }

  /** Change the amount; every line is priced anew, since discounts may count them together. */
  async setQuantity(quantity: number): Promise<this> {
    await this.#check(quantity);
    await (await this.order())?.reprice();
    return this;
  }

  /** The amount as the modules allow it (stock, packaging units). */
  async #check(quantity: number): Promise<void> {
    const e = { line: this, quantity: Math.max(0, Math.trunc(quantity)) };
    await this.$app.fire("shop:line-quantity", e);
    this.quantity = e.quantity;
  }

  /** Let the modules look at the amount again, without pricing — the order prices once after. */
  recheck(): Promise<void> { return this.#check(this.quantity); }

  async setData(data: unknown): Promise<this> {
    this.data = JSON.stringify(data);
    await (await this.order())?.reprice();
    return this;
  }

  /** Grams: the variant's, else the product's. */
  async weight(): Promise<number> {
    const variant = await this.variant();
    const weight = variant?.weight ?? (await this.product())?.weight ?? 0;
    const e = { line: this, weight: Number(weight) };
    await this.$app.fire("shop:line-weight", e);
    return e.weight;
  }

  /** What is wrong with this line; empty when it is fine. */
  async errors(): Promise<Errors> {
    const e = { line: this, errors: {} as Errors };
    await this.$app.fire("shop:line-check", e);
    return e.errors;
  }

  /** quantity × price, rounded as fin rounds it. */
  total(): number { return totals([{ name: "", quantity: Number(this.quantity), price: Number(this.price) }], false).amounts[0]; }
}

export class Order extends ShopRow {
  declare id: number;
  declare usr_id: number | null;
  declare status: Status;
  declare currency: string;
  declare lang: string;
  declare country: string;
  declare tax_included: boolean;
  declare shipping: string;
  declare payment: string;
  declare bill: string;
  declare ship: string;
  declare net: number;
  declare tax: number;
  declare total: number;
  declare data: string;
  declare created: number;
  declare changed: number;
  declare ordered: number;

  // Worked out once, dropped on every change. The row outlives the request (identity map), so
  // cart() forgets at the start of each one.
  #lines: Line[] | null = null;
  #extras: Extra[] | null = null;
  #shippings: Promise<Method[]> | null = null;
  #payments: Promise<Method[]> | null = null;
  #grps: Promise<number[]> | null = null;

  /** Drop what was worked out from the lines, the settings and the tables. */
  forget(): this {
    this.#lines = this.#grps = null;
    this.#derived();
    return this;
  }
  #derived(): void { this.#extras = this.#shippings = this.#payments = null; }

  /** The product lines, in the order they came. */
  async lines(): Promise<Line[]> {
    return this.#lines ??= await this.$table.db.table("shop_order_line").all<Line>`WHERE order_id = ${this.$id} AND ${KEY} = ${""} ORDER BY sort, id`;
  }

  async line(id: unknown): Promise<Line | undefined> {
    return (await this.lines()).find((l) => l.$id === String(id));
  }

  /** Lines the shop adds itself. A placed order reads them back, a cart lets the modules speak;
   *  keyed, so a module replaces its line instead of adding a second one. */
  async extras(): Promise<Extra[]> {
    if (this.#extras) return this.#extras;
    if (this.status !== "cart") {
      const rows = await this.$table.db.query`SELECT * FROM shop_order_line WHERE order_id = ${this.$id} AND ${KEY} <> ${""} ORDER BY sort, id`;
      return this.#extras = rows.map((r) => ({
        key: String(r.key), name: String(r.name), price: Number(r.price), taxRate: Number(r.tax_rate),
        taxCategory: String(r.tax_category ?? "S"), sort: Number(r.sort),
      }));
    }
    const e = { order: this, extras: [] as Extra[] };
    await this.$app.fire("shop:extras", e);
    const byKey = new Map(e.extras.map((x) => [x.key, x]));
    return this.#extras = [...byKey.values()].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  }

  dataOf(): Record<string, unknown> { return json(this.data) ?? {}; }

  /** A party of the order; the delivery party falls back to the billing party. */
  party(kind: "bill" | "ship"): Party | undefined {
    return json(kind === "ship" ? this.ship || this.bill : this.bill) ?? undefined;
  }

  /** Store a party; where it goes decides the country. `null` makes the delivery party the billing party. */
  async setParty(kind: "bill" | "ship", party: Party | null): Promise<this> {
    this[kind] = party ? JSON.stringify(party) : "";
    this.#derived(); // methods may depend on the address
    const country = this.party("ship")?.address?.addressCountry;
    if (country && country !== this.country) await this.setCountry(country);
    return this;
  }

  /** The order's currency; one the shop switched off meanwhile gives way to the main one. */
  async currencyRow(): Promise<Currency | undefined> {
    return await currency(this.$app, this.currency) ?? mainCurrency(this.$app);
  }

  /** Switch the currency; stored prices are in the order's currency, so every line is priced anew. */
  async setCurrency(id: string): Promise<this> {
    const row = await currency(this.$app, id);
    if (!row) throw new Error(`cms.shop: currency ${id} is not available`);
    if (this.currency === row.$id) return this;
    this.currency = row.$id;
    await this.reprice();
    return this;
  }

  /** Where it goes: tax, currency and what may be sold follow from it. */
  async setCountry(id: string): Promise<this> {
    this.country = id;
    this.currency = (await currencyFor(this.$app, id))?.$id ?? this.currency;
    await this.reprice();
    return this;
  }

  /** Price every line anew — discounts may depend on the whole cart. */
  async reprice(): Promise<this> {
    if (this.status !== "cart") return this;
    this.forget();
    for (const line of await this.lines()) {
      const product = await line.product();
      if (!product) continue;
      line.price = (await product.prices({ variant: await line.variant(), quantity: line.quantity, order: this, data: line.dataOf() })).price;
    }
    this.#derived();
    return this;
  }

  /** Put a product into the cart, or raise the amount of the same product, variant and data. */
  async add(product: Product, { variant, quantity = 1, data = null }: { variant?: Variant; quantity?: number; data?: unknown } = {}): Promise<Line> {
    const encoded = JSON.stringify(data);
    let line = (await this.lines()).find((l) =>
      String(l.product_id) === product.$id && String(l.variant_id ?? "") === String(variant?.$id ?? "") && l.data === encoded);
    if (!line) {
      line = await this.$table.db.table("shop_order_line").add<Line>({
        order_id: this.$id,
        product_id: product.$id,
        variant_id: variant?.$id ?? null,
        name: await product.title(this.lang),
        quantity: 0,
        data: encoded,
      });
      this.#lines = null;
    }
    await line!.setQuantity(Number(line!.quantity) + quantity);
    return line!;
  }

  async remove(line: Line): Promise<void> {
    await line.$remove();
    await this.reprice();
  }

  /** Grams of all goods. */
  async weight(): Promise<number> {
    let total = 0;
    for (const line of await this.lines()) total += line.quantity * await line.weight();
    return total;
  }

  /** The user's groups — prices and methods may depend on them. */
  grps(): Promise<number[]> {
    if (!this.usr_id) return Promise.resolve([]);
    return this.#grps ??= this.$table.db.col<number>`SELECT grp_id FROM usr_grp WHERE usr_id = ${this.usr_id}`.then((ids) => ids.map(Number));
  }

  /** Net, tax and total as fin computes them — tax rounded once per rate. */
  async totals(): Promise<{ net: number; tax: number; total: number; rates: { rate: number; net: number; tax: number }[] }> {
    const lines = [];
    for (const line of await this.lines()) lines.push({ name: line.name, quantity: Number(line.quantity), price: Number(line.price), taxRate: await line.taxRate() });
    for (const extra of await this.extras()) lines.push({ name: extra.name, price: extra.price, taxRate: extra.taxRate });
    const { net, tax, total, rates } = totals(lines, !!this.tax_included);
    return { net, tax, total, rates };
  }

  /** The goods alone, with tax — what thresholds compare against. */
  async goods(): Promise<number> {
    let sum = 0;
    for (const line of await this.lines()) {
      sum += this.tax_included ? line.total() : line.total() * ((await line.taxRate()) / 100 + 1);
    }
    return sum;
  }

  /** Delivery methods that fit this order, as `provider.method`. */
  shippings(): Promise<Method[]> { return this.#shippings ??= this.#offerShippings(); }
  async #offerShippings(): Promise<Method[]> {
    const offered: Method[] = [];
    for (const p of shippingProviders(this.$app)) {
      for (const m of await p.methods(this.$app, this)) offered.push({ name: m.name ? `${p.name}.${m.name}` : p.name, label: m.label });
    }
    const e = { order: this, methods: await this.#labelled(pick(offered, await listOf(settingsOf(this.$app).shippings))) };
    await this.$app.fire("shop:shippings", e);
    return e.methods;
  }

  /** What delivery costs, in the order's currency. */
  async shippingCost(name?: string): Promise<number> {
    const method = name ?? await this.activeShipping();
    const [provider, rest] = method.split(/\.(.*)/);
    const found = shippingProviders(this.$app).find((p) => p.name === provider);
    if (!found) return 0;
    const cost = await found.cost(this.$app, this, rest ?? "");
    const currency = await this.currencyRow();
    return Math.round(currency ? currency.change(cost) : cost);
  }

  /** Payment methods fin offers for this order, those the shop lists, less what a module vetoes. */
  payments(): Promise<Method[]> { return this.#payments ??= this.#offerPayments(); }
  async #offerPayments(): Promise<Method[]> {
    const { total } = await this.totals();
    if (total <= 0) return [];
    const offer = { amount: total, currency: (await this.currencyRow())?.$id ?? this.currency, country: this.country, usrId: this.usr_id ?? undefined };
    const offered = (await finMethods(this.$app, offer)).map((m) => ({ name: m.method, label: m.label }));
    const e = { order: this, methods: await this.#labelled(pick(offered, await listOf(settingsOf(this.$app).payments))) };
    await this.$app.fire("shop:payments", e);
    return e.methods;
  }

  /** Methods named as the shop labels them in the order's language; the provider's name else. */
  async #labelled(methods: Method[]): Promise<Method[]> {
    const labels = settingsOf(this.$app).labels, lang = this.lang || this.$app.languages.def;
    return Promise.all(methods.map(async (m) => ({ ...m, label: String(await labels[m.name]?.[lang] || await labels[m.name]?.[this.$app.languages.def] || m.label) })));
  }

  /** The method in force: the chosen one if it still fits, else the only one. Frozen once placed. */
  async activeShipping(): Promise<string> { return this.status === "cart" ? active(this.shipping, await this.shippings()) : this.shipping; }
  async activePayment(): Promise<string> { return this.status === "cart" ? active(this.payment, await this.payments()) : this.payment; }

  /** What blocks this order; empty when it can be placed. */
  async errors(): Promise<Errors> {
    const e = { order: this, errors: {} as Errors };
    await this.$app.fire("shop:order-check", e);
    return e.errors;
  }

  /** The checkout: priced anew, checked, and placed unless a module still stops it. */
  async place(): Promise<{ ok: boolean; errors: Errors; redirect: string }> {
    if (this.status !== "cart") throw new Error(`cms.shop: order ${this.$id} was already placed`);
    for (const line of await this.lines()) await line.recheck(); // stock and friends look again
    await this.reprice();
    const e = { order: this, errors: await this.errors(), prevent: false, redirect: "" };
    await this.$app.fire("shop:place", e);
    const ok = !e.prevent && !Object.keys(e.errors).length;
    if (ok) await this.#freeze();
    return { ok, errors: e.errors, redirect: e.redirect };
  }

  /** Freeze what was live, then mark it ordered. */
  async #freeze(): Promise<void> {
    const app = this.$app, db = this.$table.db;
    const lines = await this.lines(), extras = await this.extras();
    for (const line of lines) {
      line.tax_rate = await line.taxRate();
      line.description = await line.describe();
      line.amount = line.total();
    }
    let sort = lines.length;
    for (const extra of extras) {
      await db.table("shop_order_line").insert({
        order_id: this.$id, sort: ++sort, key: extra.key, name: extra.name, quantity: 1, price: extra.price,
        tax_rate: extra.taxRate, tax_category: extra.taxCategory ?? "S", amount: Math.round(extra.price),
      });
    }
    const { net, tax, total } = await this.totals();
    Object.assign(this, { net, tax, total, shipping: await this.activeShipping(), payment: await this.activePayment() });
    this.ordered = this.changed = unixTime();
    await this.setStatus("ordered");
    this.#derived();
    await db.flush();
    await app.fire("shop:ordered", { order: this });
    if (!total) await this.setStatus("paid"); // nothing to pay
  }

  /** Pay what the order costs, with the chosen method; returns where to send the payer. */
  async pay({ method, return: back }: { method?: string; return: string }): Promise<{ redirect: string }> {
    const party = this.party("bill");
    // a module may let the payment settle something else — the order's invoice
    const e = {
      order: this,
      payment: {
        amount: Number(this.total),
        currency: this.currency,
        method: method || this.payment,
        ref: refOf(Number(this.$id)),
        description: `${await shopT(this.$app)`Order`} ${this.$id}`,
        usrId: this.usr_id ?? undefined,
        payer: party?.name ? { name: party.name, address: party.address } : undefined,
        return: back,
      },
    };
    await this.$app.fire("shop:pay", e);
    return { redirect: (await createPayment(this.$app, e.payment)).redirect };
  }

  /** Move on; `shop:status` fires once per change. */
  async setStatus(status: Status): Promise<this> {
    const previous = this.status;
    if (previous === status) return this;
    this.status = status;
    this.changed = unixTime();
    await this.$app.fire("shop:status", { order: this, previous });
    return this;
  }

  cancel(): Promise<this> { return this.setStatus("canceled"); }
}

/** The `ref` that ties a payment or an invoice to an order. */
export const refOf = (id: number): string => `cms.shop:${id}`;

/** The order a `ref` names, if it is one. */
export const idOf = (ref: unknown): number | undefined => {
  const m = /^cms\.shop:(\d+)$/.exec(String(ref ?? ""));
  return m ? Number(m[1]) : undefined;
};

const active = (chosen: string, methods: Method[]) =>
  methods.some((m) => m.name === chosen) ? chosen : methods.length === 1 ? methods[0].name : "";

/**
 * A way to deliver, declared by a module as `export const shippingProvider` — as fin.payment finds
 * its payment providers. `cost` is in minor units of the main currency.
 */
export type ShippingProvider = {
  name: string;
  methods(app: App, order: Order): Method[] | Promise<Method[]>;
  cost(app: App, order: Order, method: string): number | Promise<number>;
};

const shippingProviders = (app: App): ShippingProvider[] =>
  app.modules.linked().filter((mod) => mod.plugin.shippingProvider).map((mod) => mod.plugin.shippingProvider as ShippingProvider);

export function registerRows(app: App): void {
  const db = app.db;
  db.table("shop_currency").rowClass = Currency;
  db.table("shop_product").rowClass = Product;
  db.table("shop_variant").rowClass = Variant;
  db.table("shop_order").rowClass = Order;
  db.table("shop_order_line").rowClass = Line;
}
