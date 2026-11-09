// shp3 → cms.shop, once: the legacy tables of the PHP shop into the shop's
// own. The legacy tables stay as they are; nothing here runs again after the install.
import { $item, fs, sql } from "@qino/qino";
import { cms, hasOwnUrl } from "@qino/qino/cms";
import { toMinor } from "@qino/qino/fin";
import { totals } from "@qino/qino/fin.invoice";

import type { App, Db, Row } from "@qino/qino";

/** Old page modules → new ones. The site's own (category.cd …) stay for the site to port. */
const MODULES: Record<string, string> = {
  "cms.cont.shp3.category1": "cms.cont.shop.category", // before the products: it gives them their addresses
  "cms.cont.shp3.product.default": "cms.cont.shop.product",
  "cms.cont.shp3.order.cart1": "cms.cont.shop.cart",
  "cms.cont.shp3.order.cart3": "cms.cont.shop.cart",
  "cms.cont.shp3.order.cart.small": "cms.cont.shop.cart.small",
  "cms.cont.shp3.order.addresses2": "cms.cont.shop.address",
  "cms.cont.shp3.order.shipping": "cms.cont.shop.shipping",
  "cms.cont.shp3.order.payment": "cms.cont.shop.payment",
  "cms.cont.shp3.order.buy1": "cms.cont.shop.buy",
  "cms.cont.shp3.order.buy": "cms.cont.shop.buy",
  "cms.cont.shp3.order.buy.accept_agb1": "cms.cont.shop.accept",
  "cms.cont.shp3.order.nextButton": "cms.cont.shop.next",
  "cms.cont.shp3.currency_chooser": "cms.cont.shop.currency",
  "cms.cont.shp3.my.orders1": "cms.cont.shop.my.orders",
  "cms.cont.shp3.my.addresses2": "cms.cont.my.address",
  "cms.backend.shp3": "cms.backend.shop",
  "cms.backend.shp3.orders1": "cms.backend.shop.orders",
  "cms.backend.shp3.orders": "cms.backend.shop.orders",
  "cms.backend.shp3.products": "cms.backend.shop.products",
  "cms.backend.shp3.settings": "cms.backend.shop.settings",
  "cms.backend.shp3.campaign1": "cms.backend.shop.discounts",
  "cms.backend.shp3.discount1": "cms.backend.shop.discounts",
  "cms.backend.shp3.shipping_by_weight_and_country": "cms.backend.shop.shipping",
  "cms.backend.shp3.coupon1": "cms.backend.shop.coupons",
  "cms.cont.shp3.coupon1": "cms.cont.shop.coupon",
  "cms.cont.shp3.my.orders": "cms.cont.shop.my.orders",
  "cms.cont.shp3.my.addresses1": "cms.cont.my.address",
  "cms.cont.shp3.order.addresses1": "cms.cont.shop.address",
  "cms.backend.shp3.props": "cms.backend.shop.products", // marks are columns of the product page now
};

/** Old keys of lines the shop added itself → the ones the modules use now. */
const EXTRAS: Record<string, string> = { minimum_order_amount: "minimum", coupon1: "coupon" };

/** Old order checks → the keys cms.shop uses. */
const CHECKS: Record<string, string> = { "has items": "has lines", "item errors": "line errors", "address": "has address" };

/** Old method names → `provider.method`. Unknown ones stay as they are, for the site to map. */
export const method = (name: string): string => {
  const weight = /^by_weight_and_country_(\w+)$/.exec(name);
  if (weight) return `weight.${weight[1]}`;
  const saferpay = /^saferpay\.(.+)$/.exec(name);
  if (saferpay) return saferpay[1] === "*" ? "saferpay" : `saferpay.${saferpay[1].toLowerCase()}`;
  if (name === "invoice") return "qrbill"; // paying by invoice is fin's QR bill on it (cms.shop.invoice)
  return name;
};

const columnsOf = async (db: Db, table: string) => new Set((await db.columns(table).catch(() => [])).map((c) => String(c.Field)));
/** Unix time from what a legacy column holds: a number, its string, or a datetime ("0000-…": none). */
const time = (v: unknown) => /^\d+$/.test(String(v ?? "")) ? Number(v) : Math.floor(Date.parse(String(v ?? "").replace(" ", "T")) / 1000) || 0;
const num = (v: unknown) => v == null || v === "" ? null : Number(v);
const json = (v: unknown) => { try { return JSON.parse(String(v || "null")); } catch { return null; } };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#039": "'", "#39": "'", nbsp: " " };
/** PHP kept descriptions as html, one div per part; qino keeps text, one line per part. */
const plain = (v: unknown) => String(v ?? "").replace(/<\/(div|p)>\s*<(div|p)[^>]*>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
  .replace(/&(\w+|#\d+);/g, (m, e) => ENTITIES[e] ?? m).trim();

/** A legacy setting by path, from the raw table — the settings tree of the app may not know it. */
async function setting(db: Db, path: string[]): Promise<{ id: number; value: string } | undefined> {
  let id = 0, value = "";
  for (const name of path) {
    const row = await db.row`SELECT id, value FROM qg_setting WHERE basis = ${id} AND ${sql.id("offset")} = ${name}`;
    if (!row) return;
    id = Number(row.id);
    value = String(row.value ?? "");
  }
  return { id, value };
}

/** The children of a legacy setting: name → { value, children }. */
async function children(db: Db, id: number): Promise<Map<string, Row>> {
  const rows = await db.query`SELECT id, ${sql.id("offset")} AS name, value FROM qg_setting WHERE basis = ${id}`;
  return new Map(rows.map((r) => [String(r.name), r]));
}

/** A party from the legacy bill_ and ship_ columns, in fin's shape. */
function party(row: Row, prefix: "bill" | "ship") {
  const v = (name: string) => String(row[`${prefix}_${name}`] ?? "").trim() || undefined;
  const givenName = v("firstname"), familyName = v("lastname"), organization = v("company");
  const address = Object.fromEntries(Object.entries({
    streetAddress: v("street"), postalCode: v("zip"), addressLocality: v("city"), addressCountry: v("country"),
  }).filter(([, x]) => x));
  const out = {
    name: organization || [givenName, familyName].filter(Boolean).join(" ") || undefined,
    honorificPrefix: v("salutation"), givenName, familyName, organization,
    email: v("email")?.toLowerCase(), telephone: v("phone"), address,
  };
  return Object.fromEntries(Object.entries(out).filter(([, x]) => x !== undefined));
}

export async function install({ app }: { app: App }): Promise<void> {
  const db = app.db;
  if (!(await columnsOf(db, "shp3_product")).size) return; // no shp3 here
  if (await db.one`SELECT id FROM shop_order LIMIT 1` || await db.one`SELECT id FROM shop_product LIMIT 1`) return;
  await db.transaction(async () => {
    const report: string[] = [];
    const vat = await setting(db, ["shp3", "vat", "included"]) ?? await setting(db, ["shp3", "vat", "mode"]);
    // a generated tax line means the prices were net, whatever the settings of an older site say
    const taxLines = (await columnsOf(db, "shp3_order_item_generated")).size ? await db.one`SELECT 1 FROM shp3_order_item_generated WHERE name LIKE ${"mwst%"} LIMIT 1` : null;
    const included = taxLines == null && (!vat || vat.value === "1" || vat.value === "included");
    const main = String(await db.one`SELECT id FROM shp3_currency WHERE main = ${true} LIMIT 1` ?? "CHF");
    const minor = (v: unknown, currency = main) => v == null || v === "" ? null : toMinor(Number(v), currency);
    // prices keep their decimals: a net price of 22.6641 CHF is 2266.41 minor units
    const fine = (v: unknown, currency = main) => v == null || v === "" ? null : Math.round(Number(v) * 10 ** 6) / 10 ** 6 * (toMinor(1, currency));

    // currencies: rounding is the old price step (smallest), closing the one for the total
    for (const c of await db.query`SELECT * FROM shp3_currency`) {
      await db.table("shop_currency").ensure({
        id: c.id, factor: Number(c.factor), active: !!Number(c.active), main: !!Number(c.main),
        rounding: Number(c.smallest || 0.01) * toMinor(1, String(c.id)) || 1,
        closing: Math.max(1, Math.round(toMinor(Number(c.smallest_closing || 0.01), String(c.id)))),
      });
    }
    const currencyCols = await columnsOf(db, "currency");
    if (currencyCols.has("shp3_minimum_order_amount") && (await columnsOf(db, "shop_currency")).has("minimum")) {
      for (const c of await db.query`SELECT * FROM currency WHERE shp3_minimum_order_amount IS NOT NULL`) {
        await db.table("shop_currency").update({ id: c.id, minimum: minor(c.shp3_minimum_order_amount, String(c.id)), minimum_surcharge: minor(c.shp3_minimum_order_amount_surcharge, String(c.id)) });
      }
    }

    // countries
    const countryCols = await columnsOf(db, "country");
    if (countryCols.has("shp3_enabled")) await db.exec`UPDATE country SET shop_enabled = (shp3_enabled = 1)`;
    if (countryCols.has("shp3_default_vat_rate")) await db.exec`UPDATE country SET shop_tax_rate = shp3_default_vat_rate WHERE shp3_default_vat_rate IS NOT NULL`;

    // products and variants; stock only where cms.shop.stock is there to keep it
    const productCols = await columnsOf(db, "shp3_product"), shopCols = await columnsOf(db, "shop_product"), stock = shopCols.has("stock");
    // marks (prop_*): the site's own columns, where its module declares them on shop_product too
    const marks = [...productCols].filter((c) => c.startsWith("prop_") && shopCols.has(c));
    const pick = (row: Row, cols: Set<string>) => ({
      weight: num(row.weight), sku: cols.has("mpn") ? row.mpn ?? null : null, gtin: cols.has("gtin") ? row.gtin ?? null : null,
      length: cols.has("dim_length") ? num(row.dim_length) : null, width: cols.has("dim_width") ? num(row.dim_width) : null,
      height: cols.has("dim_height") ? num(row.dim_height) : null, ...(stock && cols.has("stock") ? { stock: num(row.stock) ?? 0 } : {}),
    });
    const products = await db.query`SELECT * FROM shp3_product`;
    for (const p of products) {
      const values = pick(p, productCols);
      await db.table("shop_product").insert({
        id: p.id, price: fine(p.price) ?? 0, ...values, weight: values.weight ?? 0, length: values.length ?? 0, width: values.width ?? 0, height: values.height ?? 0,
        ...Object.fromEntries(marks.map((c) => [c, !!Number(p[c])])),
        ...(shopCols.has("rent_interval") && Number(p.rent_able) ? { rent_interval: p.rent_interval } : {}),
      });
    }
    report.push(`${products.length} products`);
    const variantCols = await columnsOf(db, "shp3_product_variant");
    if (variantCols.size) {
      const variants = await db.query`SELECT * FROM shp3_product_variant ORDER BY product_id, price, weight, id`;
      let sort = 0, last = 0;
      for (const v of variants) {
        sort = Number(v.product_id) === last ? sort + 1 : 0;
        last = Number(v.product_id);
        await db.table("shop_variant").insert({ id: v.id, product_id: v.product_id, sort, price: fine(v.price), ...pick(v, variantCols) });
      }
      report.push(`${variants.length} variants`);
    }
    const taxCols = await columnsOf(db, "shp3_product_mwst");
    if (taxCols.size) {
      const rate = sql.id(taxCols.has("rate") ? "rate" : "mwst"); // the name of older sites
      await db.exec`INSERT INTO shop_product_tax (product_id, country, rate) SELECT product_id, country, ${rate} FROM shp3_product_mwst`;
    }

    // what other modules keep, where they are installed
    const has = async (table: string) => (await columnsOf(db, table)).size > 0;
    if (await has("shop_price") && await has("shp3_product_price_by_currency")) {
      for (const r of await db.query`SELECT * FROM shp3_product_price_by_currency`) {
        await db.table("shop_price").ensure({ product_id: r.product_id, variant_id: Number(r.variant_id ?? 0), currency: r.currency, price: fine(r.price, String(r.currency)) });
      }
    }
    if (await has("shop_product_country") && await has("shp3_product_country_whitelist")) {
      await db.exec`INSERT INTO shop_product_country (product_id, country) SELECT DISTINCT product_id, country FROM shp3_product_country_whitelist`;
    }
    if (await has("shop_discount")) {
      const discounts = db.table("shop_discount");
      if (await has("shp3_discount1")) {
        for (const d of await db.query`SELECT * FROM shp3_discount1`) await discounts.insert({ node_id: d.cont_id, min_quantity: d.min_quantity, factor: Number(d.multiplier) });
      }
      if (await has("shp3_product_discount")) {
        for (const d of await db.query`SELECT * FROM shp3_product_discount`) await discounts.insert({ node_id: d.product_id, grp_id: Number(d.grp_id ?? 0), min_quantity: d.min_quantity, per_line: true, factor: Number(d.multiplier) });
      }
      if (await has("shp3_campaign1")) {
        // an action held through its last day
        for (const c of await db.query`SELECT * FROM shp3_campaign1`) {
          await discounts.insert({ node_id: c.page_id, factor: Number(c.value), title: c.title, start: time(c.start), end: c.end ? time(c.end) + 86400 : 0 });
        }
      }
    }
    if (await has("shop_rental") && await has("shp3_product_rented")) {
      for (const r of await db.query`SELECT * FROM shp3_product_rent_prices`) await db.table("shop_rent_price").insert({ product_id: r.product_id, selector: r.selector, multiplier: num(r.multiplier) });
      const rented = await db.query`SELECT * FROM shp3_product_rented`;
      for (const r of rented) await db.table("shop_rental").insert({ product_id: r.product_id, line_id: r.order_item_id, usr_id: Number(r.usr_id) || null, name: r.name, begins: time(r.begin), ends: time(r.end) });
      report.push(`${rented.length} rentals`);
    }
    if (await has("shop_option") && await has("shp3_product_opt")) {
      await db.exec`INSERT INTO shop_option (product_id, name, sort) SELECT product_id, opt, sort FROM shp3_product_opt`;
      for (const v of await db.query`SELECT * FROM shp3_product_opt_value`) {
        await db.table("shop_option_value").insert({ product_id: v.product_id, name: v.opt, value: v.value, price: fine(v.price) ?? 0, per_line: !!Number(v.price_per_order_item), sort: v.sort });
      }
    }
    // what PHP kept on the user is the profile of user.profile, where that is here and says nothing yet
    const usrCols = await columnsOf(db, "usr");
    if (usrCols.has("bill_street") && usrCols.has("street_address")) {
      await db.exec`UPDATE usr SET street_address = bill_street, postal_code = bill_zip, address_locality = bill_city, address_country = bill_country
        WHERE (street_address IS NULL OR street_address = '') AND bill_street <> ''`;
    }
    // an offer on the product is a discount with its days
    if (await has("shop_discount") && productCols.has("price_special_offer")) {
      for (const p of products) {
        if (Number(p.price_special_offer) > 0 && Number(p.price_special_offer) < Number(p.price)) { // 0: none
          await db.table("shop_discount").insert({ node_id: p.id, factor: Number(p.price_special_offer) / Number(p.price), start: time(p.price_special_offer_start), end: time(p.price_special_offer_end) });
        }
      }
    }
    if (await has("shop_coupon") && await has("shp3_coupon1")) {
      for (const c of await db.query`SELECT * FROM shp3_coupon1`) {
        await db.table("shop_coupon").insert({ code: c.code, title: c.title, type: c.type, value: Number(c.value), node_id: Number(c.page_id) || 0, constant: !!Number(c.constant), once: !!Number(c.once), start: time(c.start), end: time(c.end) });
      }
    }
    if (await has("shop_shipping_rate") && await has("shp3_shipping_by_weight_and_country")) {
      for (const r of await db.query`SELECT * FROM shp3_shipping_by_weight_and_country`) {
        await db.table("shop_shipping_rate").ensure({ country: r.country, method: r.type, weight: Number(r.weight), price: minor(r.price) });
      }
      const free = await setting(db, ["cms.backend.shp3.shipping_by_weight_and_country", "free_from"]);
      for (const [country, row] of free ? await children(db, free.id) : []) {
        const currency = String(await db.one`SELECT COALESCE(shop_currency, currency) FROM country WHERE id = ${country}` ?? main);
        for (const [type, t] of await children(db, Number(row.id))) {
          if (Number(t.value)) await db.table("shop_shipping_free").ensure({ country, method: type, amount: minor(t.value, currency) });
        }
      }
    }

    // settings
    const shop = app.settings["cms.shop"];
    await shop.taxIncluded(included);
    const location = await setting(db, ["shp3", "location", "country"]);
    if (location?.value) await shop.country(location.value);
    for (const kind of ["payments", "shippings"] as const) {
      const root = await setting(db, ["shp3", kind]);
      if (!root) continue;
      const enabled: [string, number][] = [];
      for (const [name, row] of await children(db, root.id)) {
        const props = await children(db, Number(row.id));
        if (props.get("enabled")?.value === "1") enabled.push([method(name), Number(props.get("sort")?.value || 0)]);
        // what the customer read: texts of the home page per language (PHP: shp3_<kind>_<name>), else the description
        const text = kind === "payments" ? "shp3_payment_" : "shp3_shipping_";
        const texts = await db.query`SELECT tl.lang, tl.text FROM page_text pt JOIN text_lang tl ON tl.text_id = pt.text_id
          WHERE pt.page_id = ${2} AND pt.name = ${text + name} AND tl.text <> ''`.catch(() => []);
        const labels = texts.length ? texts : props.get("description")?.value ? [{ lang: app.languages.def, text: props.get("description")!.value }] : [];
        for (const l of labels) await shop.labels[method(name)][String(l.lang)](String(l.text));
      }
      await shop[kind](enabled.sort((a, b) => a[1] - b[1]).map(([name]) => name).join(", "));
    }
    // which address fields are required, per party
    const FIELDS: Record<string, string> = {
      salutation: "honorificPrefix", company: "organization", firstname: "givenName", lastname: "familyName", street: "streetAddress",
      zip: "postalCode", city: "addressLocality", country: "addressCountry", phone: "telephone", email: "email",
    };
    const required = await setting(db, ["cms.cont.shp3.order.addresses2", "required"]);
    if (required && app.modules.linked().some((m) => m.name === "cms.cont.shop.address")) {
      for (const [name, row] of await children(db, required.id)) {
        const [kind, field] = name.split("_");
        if (FIELDS[field] && (kind === "bill" || kind === "ship")) await app.settings["cms.cont.shop.address"].required[kind][FIELDS[field]](row.value === "1");
      }
    }
    if (app.modules.linked().some((m) => m.name === "cms.shop.mail")) {
      const receivers = await setting(db, ["shp3.messages2", "on order", "receivers"]);
      const client = await setting(db, ["shp3.messages2", "on order", "to client"]);
      if (receivers) await app.settings["cms.shop.mail"].receivers(receivers.value.split(/[\s,;]+/).filter(Boolean).join(", "));
      if (client) await app.settings["cms.shop.mail"].toCustomer(client.value === "1");
    }

    // the payment accounts, where the site has them and fin's providers are here. Never switched
    // live: a copy of a site must not take real money until someone says so
    const saferpay = app.modules.get("fin.payment.saferpay") && await setting(db, ["shp3.payment.saferpay", "production"]);
    if (saferpay) {
      const account = await children(db, saferpay.id), value = (name: string) => String(account.get(name)?.value ?? "");
      const target = app.settings["fin.payment.saferpay"];
      if (value("json_api_username")) {
        await target.user(value("json_api_username"));
        await target.password(value("json_api_password"));
        await target.terminalId(value("terminal_id"));
        await target.customerId(/^API_(\d+)_/.exec(value("json_api_username"))?.[1] ?? "");
        const offered = String(await shop.payments() ?? "").split(",").map((m) => m.trim()).filter((m) => m.startsWith("saferpay.")).map((m) => m.slice(9).toUpperCase());
        await target.methods(offered.join(", "));
      }
    }
    if (app.modules.get("fin.payment.qrbill")) {
      const iban = (await setting(db, ["cms.backend.accounting1", "QR-IBAN"]))?.value || (await setting(db, ["cms.backend.accounting1", "IBAN"]))?.value;
      if (iban) await app.settings["fin.payment.qrbill"].iban(iban);
    }

    // placed orders; open carts are gone with the old sessions anyway
    const paidInvoices = await has("accounting1_invoice")
      ? new Set((await db.query`SELECT id, paid_time FROM accounting1_invoice`).filter((i) => time(i.paid_time) > 0).map((i) => Number(i.id)))
      : new Set<number>();
    const orders = (await db.query`SELECT * FROM shp3_order ORDER BY id`).filter((o) => time(o.time_ordered) > 0);
    const lines = db.table("shop_order_line");
    const orderCols = await columnsOf(db, "shop_order");
    const generated: Row[] = []; // after all kept ids are in: theirs are drawn anew
    const closings = new Map((await db.query`SELECT id, smallest_closing FROM shp3_currency`).map((c) => [String(c.id), c.smallest_closing]));
    let mismatch = 0;
    for (const o of orders) {
      const currency = String(o.currency || main);
      // paying by invoice was booked on the invoice, not on the order
      const paid = time(o.time_paid) > 0 || Number(o.paid) >= Number(o.cost) || paidInvoices.has(Number(o.invoice_id));
      // older sites asked for the delivery first: then the address that is always there is ship_*
      const shipFirst = !String(o.bill_street ?? "").trim() && String(o.ship_street ?? "").trim();
      const bill = party(o, shipFirst ? "ship" : "bill");
      const ship = !shipFirst && (Number(o.ship_unlike_bill) || Number(o.bill_unlike_ship)) ? party(o, "ship") : null;
      const items = await db.query`SELECT * FROM shp3_order_item WHERE order_id = ${o.id} ORDER BY id`;
      // older sites had no rate on the lines: the tax was a generated line of its own, "mwst 8.1"
      const added = await db.query`SELECT * FROM shp3_order_item_generated WHERE order_id = ${o.id} ORDER BY sort`;
      const taxLine = /^mwst\s*([\d.]+)$/i, oldRate = Number(taxLine.exec(String(added.find((g) => taxLine.test(String(g.name)))?.name ?? ""))?.[1] ?? 0);
      // stored net, with fractions of a cent where prices included tax: gross again, as it was charged
      const price = (net: unknown, rate: number) => fine(Number(net ?? 0) * (included ? 1 + rate / 100 : 1), currency) ?? 0;
      const sums: { name: string; quantity: number; price: number; taxRate: number }[] = [];
      let sort = 0;
      for (const i of items) {
        const config = json(i.config) ?? {};
        const variant = config.shp3_variant ? Number(config.shp3_variant) : null;
        delete config.shp3_variant;
        if (config.shp3_rent) { // the times, as cms.shop.rent keeps them: numbers
          config.rent = (config.shp3_rent as { begin: unknown; end: unknown }[]).map((r) => ({ begin: Number(r.begin), end: Number(r.end) }));
          delete config.shp3_rent;
        }
        if (config.shp3_opt) { // what was picked is the line's options now
          config.options = config.shp3_opt;
          delete config.shp3_opt;
        }
        const rate = Number(i.vat_rate ?? oldRate), unit = price(i.price, rate), amount = Math.round(unit * Number(i.quantity));
        sums.push({ name: "", quantity: Number(i.quantity), price: unit, taxRate: rate });
        await lines.insert({
          id: i.id, order_id: o.id, sort: ++sort, key: "", product_id: i.product_id, variant_id: variant, name: i.title,
          description: plain(i.description), quantity: Number(i.quantity), price: unit, tax_rate: rate,
          amount, data: Object.keys(config).length ? JSON.stringify(config) : null,
        });
      }
      for (const g of added) {
        if (taxLine.test(String(g.name))) continue;
        const rate = Number(g.vat_rate ?? oldRate), unit = price(g.price, rate);
        sums.push({ name: "", quantity: 1, price: unit, taxRate: rate });
        generated.push({ order_id: o.id, sort: ++sort, key: EXTRAS[g.name] ?? g.name, name: g.title, quantity: 1, price: unit, tax_rate: rate, amount: Math.round(unit) });
      }
      const { net, tax, total: computed } = totals(sums, included);
      const total = minor(o.cost, currency) ?? 0;
      const closing = Math.max(1, Math.round(toMinor(Number(closings.get(currency) ?? 0.01), currency)));
      if (Math.abs(computed - total) > Math.max(1, closing / 2)) mismatch++;
      const invoice = Number(o.invoice_id) || undefined;
      await db.table("shop_order").insert({
        id: o.id, usr_id: Number(o.usr_id) || null, status: paid ? "paid" : "ordered", currency, lang: o.lang || null,
        country: o.ship_country || o.bill_country || null, tax_included: included, shipping: method(String(o.shipping ?? "")),
        payment: method(String(o.payment ?? "")), bill: JSON.stringify(bill), email: String(bill.email ?? ""), ship: ship ? JSON.stringify(ship) : null,
        ...(orderCols.has("coupon") && o.coupon1_code ? { coupon: o.coupon1_code } : {}),
        net, tax, total, data: invoice ? JSON.stringify({ accounting1: invoice }) : null,
        created: time(o.time_created), changed: time(o.time_ordered), ordered: time(o.time_ordered),
      });
    }
    for (const line of generated) await lines.insert(line);
    report.push(`${orders.length} orders${mismatch ? ` (${mismatch} charged differently than their lines add up — the charged total is kept)` : ""}`);

    // pages: the shop's own modules under their new names, their settings under the new keys —
    // where the app has the new module; the others wait (the shop's backend pages for products …)
    // a backend page the new module made for itself stands: the old one, and what hung below it, goes
    const replaced: string[] = [];
    const waiting: string[] = [], moves = Object.entries(MODULES).filter(([, to]) => app.modules.get(to));
    for (const [from, to] of Object.entries(MODULES)) {
      const pages = await db.query`SELECT id, settings FROM page WHERE module = ${from}`;
      if (pages.length && !app.modules.get(to)) {
        waiting.push(`${pages.length} × ${from}`);
        continue;
      }
      for (const page of pages) {
        const old = await cms(app).node(Number(page.id));
        if (!old.exists()) continue; // gone with its parent
        if (to.startsWith("cms.backend.") && await cms(app).nodeByModule(to)) {
          const was = await old.page();
          await (await was.parent())?.removeChild(was);
          replaced.push(from);
          continue;
        }
        const s = json(page.settings) ?? {};
        const out: Record<string, unknown> = {};
        if (to === "cms.cont.shop.cart.small") out.mode = s.mode === "m" || s.mode === "s" ? "count" : "lines"; // PHP's default was the lines
        if ("not_editable" in s) out.editable = s.not_editable !== "1";
        if (s.heading) out.heading = Number(s.heading);
        if ("go back" in s) out.back = String(s["go back"] ?? "");
        if ("go next" in s) out.next = String(s["go next"] ?? "");
        if (s["success page"]) out.success = String(s["success page"]);
        if (s["fail page"]) out.fail = String(s["fail page"]);
        if (s.next_button_hide_on_inactive === "1") out.hideInactive = true;
        if (s["has to pass"]) {
          out.check = Object.entries(s["has to pass"] as Record<string, string>).filter(([, v]) => v === "1").map(([k]) => CHECKS[k] ?? k).join(", ");
        }
        const keep = to.startsWith("cms.backend.") ? s : out; // backend lists keep their own view settings
        // through the node, it may be loaded already; its settings item is built on load, so set it too
        const node = await cms(app).node(Number(page.id));
        await node.set({ module: to });
        await node.urlsGen(); // what lists it may give it an address now
        await node.settings[$item].set(keep);
      }
      if (pages.length) report.push(`${pages.length} × ${from} → ${to}`);
    }
    if (replaced.length) report.push(`old backend pages replaced: ${replaced.join(", ")}`);
    if (waiting.length) report.push(`left without a qino module: ${waiting.join(", ")}`);

    // the products' addresses of PHP (realurl): where they are now
    if (await has("realurl")) {
      let kept = 0;
      for (const r of await db.query`SELECT url, params FROM realurl`) {
        const params = json(r.params) ?? {};
        const id = Number(params.shp3_product);
        if (!id || !params.changeLanguage) continue;
        const node = await cms(app).node(id);
        if (!node.exists()) continue;
        // no request during the install, so no node.url(): its own address, else its page's
        const target = `/${await (await hasOwnUrl(node) ? node : await node.page()).urlSeo(String(params.changeLanguage))}`;
        await db.table("page_redirect").ensure({ request: String(r.url), redirect: target });
        kept++;
      }
      if (kept) report.push(`${kept} product addresses kept as redirects`);
    }
    // the site's own files of these modules (data/<module>/: css, images) under the new name, and
    // its css addressing the new name — qino loads data/<module>/pub/main.css by itself
    const data = app.dir + "data/";
    let moved = 0;
    for (const [from, to] of moves) {
      if (!await fs.stat(data + from) || await fs.stat(data + to)) continue;
      await fs.rename(data + from, data + to);
      moved++;
    }
    if (moved) report.push(`${moved} site folders in data/ renamed`);
    for await (const path of cssFiles(data)) {
      const before = await fs.text(path);
      let after = before;
      for (const [from, to] of moves) {
        const name = to.replace(/^cms\./, "");
        after = after.replaceAll(`[qcms-mod="${from.replace(/^cms\./, "")}"]`, `[qcms-mod="${name}"]`)
          .replace(new RegExp(RegExp.escape(".-m-" + from.replaceAll(".", "-")) + "(?![\\w-])", "g"), `[qcms-mod="${name}"]`);
      }
      after = after.replaceAll("[shp3-price", "[shop-price").replaceAll("[shp3-add", "[shop-add"); // the shop's attributes
      if (after !== before) await fs.write(path, after);
    }

    console.log(`[migrate_shp3] ${report.join(", ")}`);
  });
}

async function* cssFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.list(dir).catch(() => [])) {
    if (entry.isDirectory) yield* cssFiles(dir + entry.name + "/");
    else if (entry.name.endsWith(".css")) yield dir + entry.name;
  }
}
