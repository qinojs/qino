import { html, sql, sqlSearch } from "@qino/qino";
import { cms as cmsOf, hasOwnUrl } from "@qino/qino/cms";
import { backend } from "@qino/qino/cms.backend";
import { input, renderRows, saveRows } from "@qino/qino/cms.backend.shop";
import { mainCurrency, productUrl, shopT } from "@qino/qino/cms.shop";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Column, Rows } from "@qino/qino/cms.backend.shop";
import type { Product } from "@qino/qino/cms.shop";

const { name } = manifest;
const PER_PAGE = 100;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Products", de: "Produkte" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

/** Its first image; an offline product's would be refused. */
async function thumbnail(node: Node) {
  const file = await node.isReadable() ? [...(await node.files()).values()].find((f) => String(f.vs?.mime ?? "").startsWith("image/")) : undefined;
  return file ? html`<img src="${await file.url({ w: 60, h: 40, max: true })}" width=60 alt="" loading=lazy>` : "";
}

/** The page that lists it: its own, in a category; else the one above its own page. */
async function categoryOf(node: Node): Promise<Node | undefined> {
  const page = await node.page();
  return await hasOwnUrl(node) ? page : page.parent();
}

/** What the list changes directly. */
function listColumns(app: App, main: string): Column[] {
  const t = shopT(app);
  return [
    { name: "price", label: t`Price`, type: "money", currency: () => main },
    ...(app.modules.get("cms.shop.stock") ? [{ name: "stock", label: t`In stock`, type: "number" } as Column] : []),
  ];
}

/** Where a new product can go: the contents that give their children addresses. */
async function creatable(app: App): Promise<Node[]> {
  const modules = app.modules.linked().filter((m) => m.plugin.cms?.node?.childUrls).map((m) => m.name);
  if (!modules.length) return [];
  const ids = await app.db.col`SELECT id FROM page WHERE type = ${"c"} AND module IN (${sql.join(modules.map((m) => sql`${m}`), ", ")})`;
  const nodes = await Promise.all(ids.map((id) => cmsOf(app).node(Number(id))));
  const readable = await Promise.all(nodes.map((n) => n.isOnline()));
  return nodes.filter((_, i) => readable[i]);
}

async function list(node: Node, url: URL): Promise<HtmlString> {
  const app = node.app, t = shopT(app), lang = app.languages.def;
  const q = (key: string) => url.searchParams.get(key) ?? "";
  const main = await mainCurrency(app), page = Math.max(0, Number(q("page")) || 0);
  // every product's category: for the filter, and only here
  const all = await app.db.col`SELECT id FROM shop_product`;
  const categories = await Promise.all(all.map(async (id) => [Number(id), await categoryOf(await cmsOf(app).node(Number(id)))] as const));
  const named = new Map<number, Node>();
  for (const [, c] of categories) if (c && await c.isOnline()) named.set(c.id, c);
  const inCategory = categories.filter(([, c]) => c?.id === Number(q("category"))).map(([id]) => sql`${id}`);
  const search = sqlSearch(q("search"), ["sku", "gtin", "brand"], { exact: ["id"] });
  const title = sqlSearch(q("search"), ["tl.text"]).where; // a product's name is its page's title, not every text on it
  const where = [
    q("search") ? sql`(${search.where} OR id IN (SELECT p.id FROM page p JOIN text_lang tl ON tl.text_id = p.title_id WHERE ${title}))` : null,
    q("category") ? sql`id IN (${inCategory.length ? sql.join(inCategory, ", ") : sql`0`})` : null,
  ].filter((w) => w != null);
  const rows = await app.db.table("shop_product").all<Product>`${where.length ? sql`WHERE ${sql.join(where, " AND ")}` : sql``} ORDER BY id DESC LIMIT ${PER_PAGE + 1} OFFSET ${page * PER_PAGE}`;
  const link = (params: Record<string, unknown>) => backend.toUrl(url.pathname, { search: q("search"), category: q("category"), ...params });
  const columns = listColumns(app, main?.$id ?? ""), labels = await Promise.all(columns.map((c) => c.label));
  const options = await Promise.all([...named.values()].map(async (c) => [String(c.id), String(await c.title(lang) || c.id)] as const));
  options.sort((a, b) => a[1].localeCompare(b[1]));
  const targets = await creatable(app);
  return html.async`<div class=u2-card data-rows=shop_product data-vars="${JSON.stringify({ list: true })}">
  <div class=-head>${t`Products`}</div>
  <form method=get>
    <input type=search name=search value="${q("search")}" placeholder="${t`Title, number`}">
    <select name=category aria-label="${t`Category`}"><option value="">${options.map(([id, name]) => html`<option value="${id}" ${id === q("category") ? html`selected` : ""}>${name}`)}</select>
    <button>${t`Filter`}</button>
  </form>
  ${targets.length ? html.async`<form data-create>
    <select name=category aria-label="${t`Category`}" required>${targets.map(async (c) => html.async`<option value="${c.id}">${(await c.page()).title(lang)}`)}</select>
    <input name=title required placeholder="${t`Title`}">
    <button>${t`Add`}</button>
  </form>` : ""}
  <table class=u2-table>
    <thead><tr>
      <th>
      <th>${t`Article`}
      <th>${t`Category`}
      <th>${t`Article number`}
      ${labels.map((l) => html`<th>${l}`)}
    <tbody>${rows.slice(0, PER_PAGE).map(async (p) => {
      const product = await p.node();
      return html.async`<tr data-id="${p.$id}">
      <td>${thumbnail(product)}
      <td><a href="${link({ product: p.$id })}">${p.title(lang)}</a>${await product.isOnline() ? "" : html.async` <small>${t`Offline`}</small>`}
      <td>${(await categoryOf(product))?.showTitle()}
      <td>${p.sku}
      ${columns.map((c, i) => html`<td>${input({ ...c, label: labels[i] }, { [c.name!]: p.$get(c.name!) })}`)}`;
    })}
  </table>
  <div>
    ${page ? html.async`<a href="${link({ page: page - 1 })}">${t`Back`}</a>` : ""}
    ${rows.length > PER_PAGE ? html.async`<a href="${link({ page: page + 1 })}">${t`Next`}</a>` : ""}
  </div>
</div>`;
}

/** The tables of a product: its own, then what the installed shop modules keep per product. */
async function tables(app: App, id: number): Promise<Rows[]> {
  const t = shopT(app), has = (module: string) => !!app.modules.get(module);
  const main = (await mainCurrency(app))?.$id ?? "", inMain = () => main;
  const vars = { product: id };
  const stock: Column[] = has("cms.shop.stock") ? [{ name: "stock", label: t`In stock`, type: "number" }] : [];
  const fields = await app.db.table("shop_product").init();
  // yes-or-no marks a site declares itself (prop_bestseller)
  const marks: Column[] = [...fields.keys()].filter((f) => f.startsWith("prop_")).map((f) => ({ name: f, label: f.slice(5).replaceAll("_", " "), type: "checkbox" }));
  const measures: Column[] = [
    { name: "weight", label: t`Grams`, type: "number" },
    { name: "length", label: t`Length mm`, type: "number" },
    { name: "width", label: t`Width mm`, type: "number" },
    { name: "height", label: t`Height mm`, type: "number" },
    { name: "sku", label: t`Article number` },
    { name: "gtin", label: "GTIN" },
    ...stock,
  ];
  const specs: Rows[] = [{
    table: "shop_product", title: t`Product`, where: { id }, fixed: true, single: true, vars,
    columns: [
      { name: "price", label: t`Price`, type: "money", currency: inMain }, ...measures, { name: "brand", label: t`Brand` }, ...marks,
      ...(has("cms.shop.rent") ? [{ name: "rent_interval", label: t`Rented by` }, { name: "rent_capacity", label: t`At once`, type: "number" }] as Column[] : []),
    ],
  }, {
    table: "shop_variant", title: t`Variants`, where: { product_id: id }, order: ["sort", "id"], vars,
    columns: [{ name: "sort", label: t`Position`, type: "number" }, { name: "price", label: t`Price`, type: "money", currency: inMain }, ...measures],
  }, {
    table: "shop_product_tax", title: t`VAT of its own`, where: { product_id: id }, order: ["country"], vars,
    columns: [{ name: "country", label: t`Country` }, { name: "rate", label: t`VAT %`, type: "number" }],
  }];
  if (has("cms.shop.price.currency")) {
    const variants = await app.db.col<number>`SELECT id FROM shop_variant WHERE product_id = ${id} ORDER BY sort, id`;
    specs.push({
      table: "shop_price", title: t`Prices per currency`, where: { product_id: id }, order: ["variant_id", "currency"], vars,
      columns: [
        { name: "variant_id", label: t`Variant`, type: "select", options: [["0", ""], ...variants.map((v) => [String(v), String(v)] as [string, string])] },
        { name: "currency", label: t`Currency` },
        { name: "price", label: t`Price`, type: "money", currency: (row) => String(row.currency ?? "") },
      ],
    });
  }
  if (has("cms.shop.options")) {
    specs.push({
      table: "shop_option", title: t`Options`, where: { product_id: id }, order: ["sort", "name"], vars,
      columns: [{ name: "name", label: t`Name` }, { name: "sort", label: t`Position`, type: "number" }],
    }, {
      table: "shop_option_value", title: t`Option values`, where: { product_id: id }, order: ["name", "sort"], vars,
      columns: [
        { name: "name", label: t`Option` }, { name: "value", label: t`Value` }, { name: "price", label: t`Price`, type: "money", currency: inMain },
        { name: "per_line", label: t`Per line`, type: "checkbox" }, { name: "sort", label: t`Position`, type: "number" },
      ],
    });
  }
  if (has("cms.shop.price.discount")) {
    specs.push({
      table: "shop_discount", title: t`Discounts`, where: { node_id: id }, order: ["min_quantity"], vars,
      columns: [
        { name: "min_quantity", label: t`From quantity`, type: "number" }, { name: "per_line", label: t`Per line`, type: "checkbox" },
        { name: "factor", label: t`Factor`, type: "number" }, { name: "title", label: t`Title` },
      ],
    });
  }
  if (has("cms.shop.rent")) {
    specs.push({
      table: "shop_rent_price", title: t`Rental prices`, where: { product_id: id }, order: ["id"], vars,
      columns: [{ name: "selector", label: t`When` }, { name: "multiplier", label: t`Factor`, type: "number" }],
    });
  }
  if (has("cms.shop.shipping.product")) {
    specs.push({
      table: "shop_shipping_product", title: t`Shipping by quantity`, where: { product_id: id }, order: ["min_quantity"], vars,
      columns: [{ name: "min_quantity", label: t`From quantity`, type: "number" }, { name: "price", label: t`Price`, type: "money", currency: inMain }],
    });
  }
  if (has("cms.shop.countries")) {
    specs.push({ table: "shop_product_country", title: t`Sold in`, where: { product_id: id }, order: ["country"], vars, columns: [{ name: "country", label: t`Country` }] });
  }
  return specs;
}

async function detail(node: Node, id: number): Promise<HtmlString> {
  const app = node.app, t = shopT(app);
  const product = await app.db.table("shop_product").get<Product>(id);
  if (!product) return html.async`<div class=u2-card><div>${t`Not found.`}</div></div>`;
  return html.async`<div class=u2-flex>
  <div class=u2-card>
    <div class=-head>${product.title(app.languages.def)}</div>
    <div><a href="${productUrl(product)}" target=_blank>${t`Open the page`}</a></div>
  </div>
  ${(await tables(app, id)).map((spec) => renderRows(node, spec))}
</div>`;
}

function render(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const url = ctx.req.url.toURL();
  const id = Number(vars.product ?? url.searchParams.get("product"));
  return Number.isSafeInteger(id) && id > 0 ? detail(node, id) : list(node, url);
}

/** A new product, in a category, of the kind that lives there. */
async function create(app: App, category: number, title: string) {
  const parent = await cmsOf(app).node(category);
  if (!title.trim() || !parent.module?.plugin.cms?.node?.childUrls) return { ok: false };
  const kind = await app.db.one<string>`SELECT p.module FROM page p JOIN shop_product s ON s.id = p.id WHERE p.basis = ${category} LIMIT 1`;
  const child = await parent.createCont({ module: kind ?? "cms.cont.shop.product", visible: true });
  await app.db.table("shop_product").ensure({ id: child.id });
  await child.title(app.languages.def, title.trim());
  return { ok: true, product: child.id };
}

/** Node access is the permission: whoever may open this page may change a product. */
async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  if (vars.create) {
    const { category, title } = vars.create as Record<string, unknown>;
    return create(app, Number(category), String(title ?? ""));
  }
  if (vars.list) {
    const main = (await mainCurrency(app))?.$id ?? "";
    return saveRows(node, [{ table: "shop_product", title: "", fixed: true, columns: listColumns(app, main) }], vars);
  }
  return saveRows(node, await tables(node.app, Number(vars.product)), vars);
}

export const cms = { node: { render, api, js: ["../cms.backend.shop/pub/rows.js", "pub/main.js"] } };
