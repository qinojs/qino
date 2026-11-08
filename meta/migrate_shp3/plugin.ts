// shp3 → cms.shop, once: the legacy tables of the PHP shop (or of qino's shp3 port) into the shop's
// own. The legacy tables stay as they are; nothing here runs again after the install.
import { $item, fs, sql } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { toMinor } from "@qino/qino/fin";
import { totals } from "@qino/qino/fin.invoice";

import type { App, Db, Row } from "@qino/qino";

/** Old page modules → new ones. The site's own (category.cd …) stay for the site to port. */
const MODULES: Record<string, string> = {
  "cms.cont.shp3.product.default": "cms.cont.shop.product",
  "cms.cont.shp3.order.cart1": "cms.cont.shop.cart",
  "cms.cont.shp3.order.cart3": "cms.cont.shop.cart",
  "cms.cont.shp3.order.cart.small": "cms.cont.shop.cart.small",
  "cms.cont.shp3.order.addresses2": "cms.cont.shop.address",
  "cms.cont.shp3.order.shipping": "cms.cont.shop.shipping",
  "cms.cont.shp3.order.payment": "cms.cont.shop.payment",
  "cms.cont.shp3.order.buy1": "cms.cont.shop.buy",
  "cms.cont.shp3.order.nextButton": "cms.cont.shop.next",
  "cms.backend.shp3": "cms.backend.shop",
  "cms.backend.shp3.orders1": "cms.backend.shop.orders",
  "cms.backend.shp3.products": "cms.backend.shop.products",
  "cms.backend.shp3.settings": "cms.backend.shop.settings",
};

/** Old keys of lines the shop added itself → the ones the modules use now. */
const EXTRAS: Record<string, string> = { minimum_order_amount: "minimum" };

/** Old order checks → the keys cms.shop uses. */
const CHECKS: Record<string, string> = { "has items": "has lines", "item errors": "line errors", "address": "has address" };

/** Old method names → `provider.method`. Unknown ones stay as they are, for the site to map. */
export const method = (name: string): string => {
  const weight = /^by_weight_and_country_(\w+)$/.exec(name);
  if (weight) return `weight.${weight[1]}`;
  const saferpay = /^saferpay\.(.+)$/.exec(name);
  if (saferpay) return saferpay[1] === "*" ? "saferpay" : `saferpay.${saferpay[1].toLowerCase()}`;
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
    const included = !vat || vat.value === "1" || vat.value === "included";
    const main = String(await db.one`SELECT id FROM shp3_currency WHERE main = ${true} LIMIT 1` ?? "CHF");
    const minor = (v: unknown, currency = main) => v == null || v === "" ? null : toMinor(Number(v), currency);
    // prices keep their decimals: a net price of 22.6641 CHF is 2266.41 minor units
    const fine = (v: unknown, currency = main) => v == null || v === "" ? null : Math.round(Number(v) * 10 ** 6) / 10 ** 6 * (toMinor(1, currency));

    // currencies: rounding is the old price step (smallest); the step for totals had no use
    for (const c of await db.query`SELECT * FROM shp3_currency`) {
      await db.table("shop_currency").ensure({
        id: c.id, factor: Number(c.factor), active: !!Number(c.active), main: !!Number(c.main),
        rounding: Math.max(1, Math.round(toMinor(Number(c.smallest || 0.01), String(c.id)))),
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
    const productCols = await columnsOf(db, "shp3_product"), stock = (await columnsOf(db, "shop_product")).has("stock");
    const pick = (row: Row, cols: Set<string>) => ({
      weight: num(row.weight), sku: cols.has("mpn") ? row.mpn ?? null : null, gtin: cols.has("gtin") ? row.gtin ?? null : null,
      length: cols.has("dim_length") ? num(row.dim_length) : null, width: cols.has("dim_width") ? num(row.dim_width) : null,
      height: cols.has("dim_height") ? num(row.dim_height) : null, ...(stock && cols.has("stock") ? { stock: num(row.stock) ?? 0 } : {}),
    });
    const products = await db.query`SELECT * FROM shp3_product`;
    for (const p of products) {
      const values = pick(p, productCols);
      await db.table("shop_product").insert({ id: p.id, price: fine(p.price) ?? 0, ...values, weight: values.weight ?? 0, length: values.length ?? 0, width: values.width ?? 0, height: values.height ?? 0 });
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
    if ((await columnsOf(db, "shp3_product_mwst")).size) {
      await db.exec`INSERT INTO shop_product_tax (product_id, country, rate) SELECT product_id, country, rate FROM shp3_product_mwst`;
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
        for (const d of await db.query`SELECT * FROM shp3_product_discount`) await discounts.insert({ node_id: d.product_id, grp_id: Number(d.grp_id ?? 0), min_quantity: d.min_quantity, factor: Number(d.multiplier) });
      }
      if (await has("shp3_campaign1")) {
        // an action held through its last day
        for (const c of await db.query`SELECT * FROM shp3_campaign1`) {
          await discounts.insert({ node_id: c.page_id, factor: Number(c.value), title: c.title, start: time(c.start), end: c.end ? time(c.end) + 86400 : 0 });
        }
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

    // placed orders; open carts are gone with the old sessions anyway
    const orders = (await db.query`SELECT * FROM shp3_order ORDER BY id`).filter((o) => time(o.time_ordered) > 0);
    const lines = db.table("shop_order_line");
    const generated: Row[] = []; // after all kept ids are in: theirs are drawn anew
    let mismatch = 0;
    for (const o of orders) {
      const currency = String(o.currency || main);
      const paid = time(o.time_paid) > 0 || Number(o.paid) >= Number(o.cost);
      const ship = Number(o.ship_unlike_bill) ? party(o, "ship") : null;
      const items = await db.query`SELECT * FROM shp3_order_item WHERE order_id = ${o.id} ORDER BY id`;
      // stored net, with fractions of a cent where prices included tax: gross again, as it was charged
      const price = (net: unknown, rate: number) => fine(Number(net ?? 0) * (included ? 1 + rate / 100 : 1), currency) ?? 0;
      const sums: { name: string; quantity: number; price: number; taxRate: number }[] = [];
      let sort = 0;
      for (const i of items) {
        const config = json(i.config) ?? {};
        const variant = config.shp3_variant ? Number(config.shp3_variant) : null;
        delete config.shp3_variant;
        const rate = Number(i.vat_rate ?? 0), unit = price(i.price, rate), amount = Math.round(unit * Number(i.quantity));
        sums.push({ name: "", quantity: Number(i.quantity), price: unit, taxRate: rate });
        await lines.insert({
          id: i.id, order_id: o.id, sort: ++sort, key: "", product_id: i.product_id, variant_id: variant, name: i.title,
          description: plain(i.description), quantity: Number(i.quantity), price: unit, tax_rate: rate,
          amount, data: Object.keys(config).length ? JSON.stringify(config) : null,
        });
      }
      for (const g of await db.query`SELECT * FROM shp3_order_item_generated WHERE order_id = ${o.id} ORDER BY sort`) {
        const rate = Number(g.vat_rate ?? 0), unit = price(g.price, rate);
        sums.push({ name: "", quantity: 1, price: unit, taxRate: rate });
        generated.push({ order_id: o.id, sort: ++sort, key: EXTRAS[g.name] ?? g.name, name: g.title, quantity: 1, price: unit, tax_rate: rate, amount: Math.round(unit) });
      }
      const { net, tax, total: computed } = totals(sums, included);
      const total = minor(o.cost, currency) ?? 0;
      if (Math.abs(computed - total) > 1) mismatch++;
      const invoice = Number(o.invoice_id) || undefined;
      await db.table("shop_order").insert({
        id: o.id, usr_id: Number(o.usr_id) || null, status: paid ? "paid" : "ordered", currency, lang: o.lang || null,
        country: o.ship_country || o.bill_country || null, tax_included: included, shipping: method(String(o.shipping ?? "")),
        payment: method(String(o.payment ?? "")), bill: JSON.stringify(party(o, "bill")), ship: ship ? JSON.stringify(ship) : null,
        net, tax, total, data: invoice ? JSON.stringify({ accounting1: invoice }) : null,
        created: time(o.time_created), changed: time(o.time_ordered), ordered: time(o.time_ordered),
      });
    }
    for (const line of generated) await lines.insert(line);
    report.push(`${orders.length} orders${mismatch ? ` (${mismatch} charged differently than their lines add up — the charged total is kept)` : ""}`);

    // the products' addresses of PHP (realurl): where the page is asked for the product alone
    if (await has("realurl")) {
      let kept = 0;
      for (const r of await db.query`SELECT url, params FROM realurl`) {
        const params = json(r.params) ?? {};
        const id = Number(params.shp3_product);
        if (!id || !params.changeLanguage) continue;
        const node = await cms(app).node(id);
        if (!node.exists()) continue;
        // no request during the install, so no node.url(): the page's address as PHP left it
        const url = await db.one`SELECT url FROM page_url WHERE page_id = ${(await node.page()).id} AND lang = ${String(params.changeLanguage)}`;
        if (url == null) continue;
        const target = `/${url}?shop_product=${id}`;
        await db.table("page_redirect").ensure({ request: String(r.url), redirect: target });
        kept++;
      }
      if (kept) report.push(`${kept} product addresses kept as redirects`);
    }

    // pages: the shop's own modules under their new names, their settings under the new keys
    for (const [from, to] of Object.entries(MODULES)) {
      const pages = await db.query`SELECT id, settings FROM page WHERE module = ${from}`;
      for (const page of pages) {
        const s = json(page.settings) ?? {};
        const out: Record<string, unknown> = {};
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
        await node.settings[$item].set(keep);
      }
      if (pages.length) report.push(`${pages.length} × ${from} → ${to}`);
    }
    // the site's own files of these modules (data/<module>/: css, images) under the new name, and
    // its css addressing the new name — qino loads data/<module>/pub/main.css by itself
    const data = app.dir + "data/";
    let moved = 0;
    for (const [from, to] of Object.entries(MODULES)) {
      if (!await fs.stat(data + from) || await fs.stat(data + to)) continue;
      await fs.rename(data + from, data + to);
      moved++;
    }
    if (moved) report.push(`${moved} site folders in data/ renamed`);
    for await (const path of cssFiles(data)) {
      const before = await fs.text(path);
      let after = before;
      for (const [from, to] of Object.entries(MODULES)) {
        const name = to.replace(/^cms\./, "");
        after = after.replaceAll(`[qcms-mod="${from.replace(/^cms\./, "")}"]`, `[qcms-mod="${name}"]`)
          .replace(new RegExp(RegExp.escape(".-m-" + from.replaceAll(".", "-")) + "(?![\\w-])", "g"), `[qcms-mod="${name}"]`);
      }
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
