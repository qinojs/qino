// The shop domain: one class per table, data and behaviour in the same object.
// Naming rule of the row layer — columns are data, methods are verbs. `price` is a column,
// so the calculation beside it is `pricesFor()`, not `price()`.

import { DbRow, type Db, unixTime } from "../../../module/core/mod.ts";
import { appOf, vatIncluded } from "./shop.ts";
import { vatRate } from "./country.ts";
import { methods, pick } from "./methods.ts";
import { cms } from "../../../module/cms/mod.ts";

// A rounding step carries float noise: the legacy column was FLOAT, so 0.01 comes back as
// 0.009999999776482582 once widened to DOUBLE. Six significant digits are more than any
// currency's smallest unit needs, and they wash the noise out.
const step = (v: number) => Number(Number(v).toPrecision(6));
const decimals = (s: number) => String(s).split(".")[1]?.length ?? 0;
const snap = (price: number, s: number) => Number((Math.round(price / s) * s).toFixed(decimals(s)));

export class Currency extends DbRow {
  declare id: string;
  declare factor: number;
  declare smallest: number;
  declare smallest_closing: number;
  declare active: boolean;
  declare main: boolean;

  change(price: number): number { return price * this.factor; }
  unchange(price: number): number { return price / this.factor; }
  round(price: number): number { return snap(price, step(this.smallest)); }
  /** Rounds what the customer actually pays — some currencies dropped their smallest coin. */
  closing(price: number): number { return snap(price, step(this.smallest_closing || this.smallest)); }
  /** As many decimals as the smallest coin has. */
  format(price: number): string { return Number(price).toFixed(decimals(step(this.smallest))); }
  show(price: number): string { return `${this.id} ${this.format(price)}`; }
  changeAndRound(price: number): number { return this.round(this.change(price)); }
}

export class Product extends DbRow {
  declare id: number;
  declare price: number;
  declare weight: number;

  #vatRates: Record<string, number> = {};

  /** VAT for a country: the product's own rate, else the country's. */
  async vatRateFor(country: string): Promise<number> {
    if (!(country in this.#vatRates)) {
      const rate = await this.$table.db.one`SELECT rate FROM shp3_product_mwst WHERE product_id = ${this.$id} AND country = ${country}`;
      this.#vatRates[country] = rate == null ? await vatRate(this.$table.db, country) : Number(rate);
    }
    return this.#vatRates[country];
  }

  /** Net and gross unit price. Modules bend the price in four passes, and the order matters:
   *  a discount has to see the surcharges, and the aesthetic rounding has to come last. */
  async pricesFor(opts: { currency?: Currency; quantity?: number; country?: string; config?: unknown; grps?: number[]; time?: number }): Promise<{ net: number; gross: number }> {
    // time lets an offer module ask "what would this cost at that moment" — 0 is before any offer.
    const e = { product: this, price: this.price, time: unixTime(), ...opts };
    const app = appOf(this.$table.db);
    for (const phase of PRICE_PHASES) await app.fire(`shp3:price-${phase}`, e);
    const factor = (await this.vatRateFor(opts.country ?? "")) / 100 + 1;
    const price = opts.currency ? opts.currency.change(e.price) : e.price;
    return await vatIncluded(this.$table.db)
      ? { net: price / factor, gross: price }
      : { net: price, gross: price * factor };
  }

  /** What keeps this product out of a cart; empty when it can be sold. */
  async errors(): Promise<Record<string, string>> {
    const e = { product: this, errors: {} as Record<string, string> };
    await appOf(this.$table.db).fire("shp3:product-check", e);
    return e.errors;
  }
}

export class OrderItem extends DbRow {
  declare id: number;
  declare order_id: number;
  declare product_id: number;
  declare quantity: number;
  declare title: string;
  declare description: string;
  declare price: number;
  declare vat_rate: number;
  declare config: string;

  order(): Promise<Order | undefined> { return this.$table.db.table("shp3_order").get<Order>(this.order_id); }
  product(): Promise<Product | undefined> { return this.$table.db.table("shp3_product").get<Product>(this.product_id); }

  configData(): unknown { return this.config ? JSON.parse(this.config) : null; }

  /** Frozen once the order is placed, live before that. */
  async calcVatRate(): Promise<number> {
    const order = await this.order();
    if (!order || order.time_ordered) return this.vat_rate;
    return await (await this.product())?.vatRateFor(order.shipCountry()) ?? 0;
  }

  async calcDescription(): Promise<string> {
    const order = await this.order();
    if (order?.time_ordered) return this.description;
    const e = { item: this, description: "" };
    await appOf(this.$table.db).fire("shp3:item-description", e);
    return e.description;
  }

  /** What the unit would cost today — the yardstick for a price that went stale in the cart. */
  async calcPrice(): Promise<number> {
    const order = await this.order();
    const product = await this.product();
    if (!order || !product) return this.price;
    const prices = await product.pricesFor({
      currency: await order.currencyRow(),
      quantity: this.quantity,
      country: order.shipCountry(),
      config: this.configData(),
      grps: await order.grps(),
    });
    return prices.net;
  }

  /** Changing the amount re-prices the row — quantity discounts are a price event. */
  async setQuantity(quantity: number): Promise<this> {
    const e = { item: this, quantity: Math.trunc(quantity) };
    await appOf(this.$table.db).fire("shp3:item-quantity", e);
    this.quantity = e.quantity;
    this.price = await this.calcPrice();
    return this;
  }

  async setConfig(data: unknown): Promise<this> {
    this.config = JSON.stringify(data);
    this.price = await this.calcPrice();
    return this;
  }

  async weight(): Promise<number> {
    const e = { item: this, weight: (await this.product())?.weight ?? 0 };
    await appOf(this.$table.db).fire("shp3:item-weight", e);
    return e.weight;
  }

  /** What is wrong with this line; empty when it is fine. */
  async errors(): Promise<Record<string, string>> {
    const e = { item: this, errors: {} as Record<string, string> };
    await appOf(this.$table.db).fire("shp3:item-check", e);
    return e.errors;
  }

  onePrice(): number { return Number(this.price); }
  rowPrice(): number { return this.onePrice() * this.quantity; }
  async oneGross(): Promise<number> { return this.onePrice() * ((await this.calcVatRate()) / 100 + 1); }
  async rowGross(): Promise<number> { return (await this.oneGross()) * this.quantity; }
}

export class Order extends DbRow {
  declare id: number;
  declare usr_id: number;
  declare time_created: number;
  declare time_ordered: number;
  declare time_paid: number;
  declare cost: number;
  declare cost_real: number;
  declare paid: number;
  declare currency: string;
  declare shipping: string;
  declare payment: string;
  declare lang: string;
  declare bill_country: string;
  declare ship_country: string;
  declare ship_unlike_bill: boolean;
  declare config: string;

  #items: OrderItem[] | null = null;
  #generated: GeneratedItem[] | null = null;

  async items(): Promise<OrderItem[]> {
    return this.#items ??= await this.$table.db.table("shp3_order_item").all<OrderItem>`WHERE order_id = ${this.$id} ORDER BY id`;
  }

  async item(id: unknown): Promise<OrderItem | undefined> {
    return (await this.items()).find((i) => i.$id === String(id));
  }

  /** A currency the shop switched off meanwhile is not honoured — the main one steps in. */
  async currencyRow(): Promise<Currency | undefined> {
    const db = this.$table.db;
    const own = this.currency ? await db.table("shp3_currency").get<Currency>(this.currency) : undefined;
    return own?.active ? own : await mainCurrency(db);
  }

  /** Switching currency re-prices every line — a stored price is in the order's currency. */
  async setCurrency(id: string): Promise<this> {
    const currency = await this.$table.db.table("shp3_currency").get<Currency>(id);
    if (!currency?.active) throw new Error(`shp3: currency ${id} is not available`);
    if (this.currency === currency.$id) return this;
    this.currency = currency.$id;
    for (const item of await this.items()) item.price = await item.calcPrice();
    return this;
  }

  shipCountry(): string {
    return (this.ship_unlike_bill ? this.ship_country : this.bill_country) || this.ship_country || "";
  }

  configData(): unknown { return this.config ? JSON.parse(this.config) : null; }

  async weight(): Promise<number> {
    let total = 0;
    for (const item of await this.items()) total += item.quantity * await item.weight();
    return total;
  }

  /** The customer's groups — group prices depend on them. */
  async grps(): Promise<number[]> {
    if (!this.usr_id) return [];
    return (await this.$table.db.col<number>`SELECT grp_id FROM usr_grp WHERE usr_id = ${this.usr_id}`).map(Number);
  }

  /** Enabled methods, minus what a module vetoes for this order. */
  async allowedPayments(): Promise<Record<string, string>> {
    const e = { order: this, payments: await methods(this.$table.db, "payments") };
    await appOf(this.$table.db).fire("shp3:payments", e);
    return e.payments;
  }
  async allowedShippings(): Promise<Record<string, string>> {
    const e = { order: this, shippings: await methods(this.$table.db, "shippings") };
    await appOf(this.$table.db).fire("shp3:shippings", e);
    return e.shippings;
  }

  /** The method in force. Frozen once placed, otherwise the chosen or auto-selected one. */
  async activePayment(): Promise<string> {
    if (this.time_ordered) return this.payment;
    return await pick(this.$table.db, "payments", this.payment, await this.allowedPayments());
  }
  async activeShipping(): Promise<string> {
    if (this.time_ordered) return this.shipping;
    return await pick(this.$table.db, "shippings", this.shipping, await this.allowedShippings());
  }

  /** What shipping costs — every rule is a listener. */
  async shippingCost(shipping?: string): Promise<number> {
    const e = { order: this, shipping: shipping ?? await this.activeShipping(), cost: 0 };
    await appOf(this.$table.db).fire("shp3:shipping-cost", e);
    return (await this.currencyRow())?.changeAndRound(e.cost) ?? e.cost;
  }

  /** Add a product, or raise the amount if it is already in the cart with the same config. */
  async itemAdd(productId: unknown, quantity = 1, config: unknown = null): Promise<OrderItem> {
    const db = this.$table.db;
    const product = await db.table("shp3_product").get<Product>(productId);
    if (!product) throw new Error(`shp3: no product ${productId}`);
    const configString = JSON.stringify(config);
    let item = (await this.items()).find((i) => String(i.product_id) === product.$id && i.config === configString);
    if (!item) {
      item = await db.table("shp3_order_item").add<OrderItem>({
        order_id: this.$id,
        product_id: product.$id,
        title: await productTitle(product, this.lang),
        config: configString,
      });
      this.#items = null;
    }
    await item!.setQuantity(item!.quantity + quantity);
    return item!;
  }

  /** Apply what changed under the customer's feet; a line that stays broken is dropped. */
  async resolveItem(id: unknown): Promise<OrderItem | undefined> {
    const item = await this.item(id);
    if (!item) return;
    item.price = await item.calcPrice();
    if (!Object.keys(await item.errors()).length) return item;
    await this.itemRemove(item);
  }

  async itemRemove(id: unknown): Promise<void> {
    const item = await this.item(id);
    if (!item) throw new Error(`shp3: order ${this.$id} has no item ${id}`);
    await item.$remove();
    this.#items = null;
  }

  /** Shop-added lines. Placed orders read them back, open ones let the modules speak. */
  async generatedItems(): Promise<GeneratedItem[]> {
    if (this.#generated) return this.#generated;
    const db = this.$table.db;
    if (this.time_ordered) {
      const rows = await db.query<GeneratedItem>`SELECT * FROM shp3_order_item_generated WHERE order_id = ${this.$id} ORDER BY sort`;
      return this.#generated = rows.map((r) => ({ ...r, price: Number(r.price), vat_rate: Number(r.vat_rate) }));
    }
    const e = { order: this, items: [] as GeneratedItem[] };
    await appOf(db).fire("shp3:generated-items", e);
    const included = await vatIncluded(db);
    // Keyed by name, like the legacy array: a module replaces another module's line, never doubles it.
    const byName = new Map<string, GeneratedItem>();
    e.items.forEach((item, i) => byName.set(item.name, {
      ...item,
      sort: item.sort || i + 1,
      price: included ? item.price / (item.vat_rate / 100 + 1) : item.price,
    }));
    return this.#generated = [...byName.values()].sort((a, b) => a.sort - b.sort);
  }

  /** Net, gross and the tax per rate. */
  async costs(): Promise<{ net: number; gross: number; taxes: Record<string, number> }> {
    const taxes: Record<string, number> = {};
    let net = 0;
    const add = (rowPrice: number, rate: number) => {
      net += rowPrice;
      taxes[String(rate)] = (taxes[String(rate)] ?? 0) + rowPrice * (rate / 100);
    };
    for (const item of await this.items()) add(item.rowPrice(), await item.calcVatRate());
    for (const item of await this.generatedItems()) add(item.price, item.vat_rate);
    const tax = Object.values(taxes).reduce((a, b) => a + b, 0);
    delete taxes["0"];
    const currency = await this.currencyRow();
    return { net, taxes, gross: currency ? currency.round(net + tax) : net + tax };
  }

  /** What blocks this order; empty when it can be placed. */
  async errors(): Promise<Record<string, string>> {
    const e = { order: this, errors: {} as Record<string, string> };
    await appOf(this.$table.db).fire("shp3:order-check", e);
    return e.errors;
  }

  /** The checkout: nothing is placed while an error stands, and a module may still stop it. */
  async tryPlace(config: unknown = null): Promise<{ success: boolean; errors: Record<string, string>; redirect: string }> {
    if (config !== null) this.config = JSON.stringify(config);
    for (const item of await this.items()) await item.setQuantity(item.quantity); // let stock and friends look again
    const e = { order: this, errors: await this.errors(), redirect: "", prevent: false };
    e.prevent = Object.keys(e.errors).length > 0;
    if (!e.prevent) await appOf(this.$table.db).fire("shp3:order-try", e);
    if (!e.prevent) await this.place();
    return { success: !e.prevent, errors: e.errors, redirect: e.redirect };
  }

  /** Freeze the calculated values, then stamp the time. Unguarded — the checkout is tryPlace(). */
  async place(): Promise<this> {
    if (this.time_ordered) throw new Error(`shp3: order ${this.$id} was already placed`);
    const db = this.$table.db;
    for (const item of await this.items()) {
      item.vat_rate = await item.calcVatRate();
      item.description = await item.calcDescription();
    }
    for (const item of await this.generatedItems()) {
      await db.table("shp3_order_item_generated").ensure({ ...item, order_id: this.$id });
    }
    this.shipping = await this.activeShipping();
    this.payment = await this.activePayment();
    const { gross } = await this.costs();
    const currency = await this.currencyRow();
    this.cost = gross;
    this.cost_real = currency ? currency.unchange(gross) : gross;
    this.ship_country = this.shipCountry();
    this.time_ordered = unixTime(); // last: everything above still reads the open state
    await db.flush();
    await appOf(db).fire("shp3:ordered", { order: this });
    if (!this.cost) await this.pay(0); // nothing to pay
    await appOf(db).fire("shp3:ordered-after", { order: this }); // everything settled, payment included
    return this;
  }

  async pay(value: number): Promise<this> {
    this.time_paid = unixTime();
    this.paid = Number(this.paid) + value;
    await appOf(this.$table.db).fire("shp3:paid", { order: this, value });
    return this;
  }
}

/** A line the shop adds itself — shipping, discounts, fees. A table row only once ordered. */
export interface GeneratedItem {
  name: string;
  sort: number;
  title: string;
  price: number;
  vat_rate: number;
}

const PRICE_PHASES = ["initial", "additions", "discount", "final"] as const;

/** The shop's own currency. Nobody marked one as main? Then the first active one has to do. */
export async function mainCurrency(db: Db): Promise<Currency | undefined> {
  return (await db.table("shp3_currency").all<Currency>`WHERE active = ${true} ORDER BY main DESC LIMIT 1`)[0];
}

/** A product is a page, so its title is the page's — translated, with the page name as fallback. */
async function productTitle(product: Product, lang?: string) {
  const app = appOf(product.$table.db);
  const node = await cms(app).node(Number(product.$id));
  // An untranslated language is an empty string, not null — so each step has to be checked.
  const title = await node.title(lang || app.languages.def) || await node.title(app.languages.def) || node.vs.name;
  const e = { product, title: String(title || product.$id) };
  await app.fire("shp3:item-title", e);
  return e.title;
}

export function registerRows(db: Db): void {
  db.table("shp3_currency").rowClass = Currency;
  db.table("shp3_product").rowClass = Product;
  db.table("shp3_order").rowClass = Order;
  db.table("shp3_order_item").rowClass = OrderItem;
}
