import { html, sql, sqlSearch } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { renderRows, saveRows } from "@qino/qino/cms.backend.shop";
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

/** Products are pages, their names are the pages' titles — not every other text on them. */
const titled = (tokens: string) => sqlSearch(tokens, ["tl.text"]).where;

async function list(node: Node, url: URL): Promise<HtmlString> {
  const app = node.app, t = shopT(app);
  const q = (key: string) => url.searchParams.get(key) ?? "";
  const main = await mainCurrency(app), page = Math.max(0, Number(q("page")) || 0);
  const search = sqlSearch(q("search"), ["sku", "gtin", "brand"], { exact: ["id"] });
  const title = titled(q("search"));
  const where = q("search") ? sql`WHERE ${search.where} OR id IN (SELECT p.id FROM page p JOIN text_lang tl ON tl.text_id = p.title_id WHERE ${title})` : sql``;
  const rows = await app.db.table("shop_product").all<Product>`${where} ORDER BY id DESC LIMIT ${PER_PAGE + 1} OFFSET ${page * PER_PAGE}`;
  const link = (params: Record<string, unknown>) => backend.toUrl(url.pathname, { search: q("search"), ...params });
  return html.async`<div class=u2-card>
  <div class=-head>${t`Products`}</div>
  <form method=get>
    <input type=search name=search value="${q("search")}" placeholder="${t`Title, number`}">
    <button>${t`Filter`}</button>
  </form>
  <table class=u2-table>
    <thead><tr>
      <th>${t`No.`}
      <th>${t`Article`}
      <th>${t`Article number`}
      <th>${t`Price`}
    <tbody>${rows.slice(0, PER_PAGE).map((p) => html.async`<tr>
      <td><a href="${link({ product: p.$id })}">${p.$id}</a>
      <td>${p.title(app.languages.def)}
      <td>${p.sku}
      <td>${main?.format(Number(p.price)) ?? p.price}`)}
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
  const measures = (): Column[] => [
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
    columns: [{ name: "price", label: t`Price`, type: "money", currency: inMain }, ...measures(), { name: "brand", label: t`Brand` }, ...marks],
  }, {
    table: "shop_variant", title: t`Variants`, where: { product_id: id }, order: ["sort", "id"], vars,
    columns: [{ name: "sort", label: t`Position`, type: "number" }, { name: "price", label: t`Price`, type: "money", currency: inMain }, ...measures()],
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

/** Node access is the permission: whoever may open this page may change a product. */
async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  return saveRows(node, await tables(node.app, Number(vars.product)), vars);
}

export const cms = { node: { render, api, js: ["../cms.backend.shop/pub/rows.js"] } };
