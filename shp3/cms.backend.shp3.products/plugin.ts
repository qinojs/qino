import { html, type HtmlString, getCtx, sql, tableRef, type App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import { backend } from "@qino/qino/cms.backend";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Products", de: "Produkte" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

function render(node: Node): Promise<HtmlString> {
  const id = Number(getCtx().req.query.shp3_productId ?? 0);
  return id ? renderProduct(node, id) : renderList(node);
}

/** Every page using the product module is listed — also one whose product row is still missing,
 *  which is exactly the page an editor just created in the tree. */
async function renderList(node: Node): Promise<HtmlString> {
  const { app } = node;
  const t = app.t;
  const hasStock = !!app.db.table("shp3_product").field("stock"); // shp3.stock adds it
  const module = String(await app.settings.shp3.default_product_module ?? "");

  // The title lives in the text table, page.name is only the internal short name — joined here
  // instead of asking each node, which would be one query per row. An untranslated language is
  // an empty string, not NULL, so COALESCE alone would stop at it.
  const lang = getCtx().lang;
  const rows = await app.db.query`SELECT page.id, page.name, p.price, p.weight ${hasStock ? sql`, p.stock` : sql.raw("")},
      COALESCE(NULLIF(t.text, ''), NULLIF(tf.text, ''), page.name) AS title
    FROM page
    LEFT JOIN shp3_product p ON p.id = page.id
    LEFT JOIN ${sql.id(tableRef("text"))} t  ON t.id = page.title_id AND t.lang = ${lang}
    LEFT JOIN ${sql.id(tableRef("text"))} tf ON tf.id = page.title_id AND tf.lang = ${app.languages.def}
    WHERE page.module = ${module} OR p.id IS NOT NULL
    ORDER BY title LIMIT 500`;

  const trs = rows.map((vs) => html`<tr itemid=${vs.id}>
    <td><a href="?shp3_productId=${vs.id}">${vs.id}</a>
    <td>${vs.title || vs.id}
    <td><input class=-f data-field=price type=number step=any value=${Number(vs.price ?? 0)}>
    <td><input class=-f data-field=weight type=number step=any value=${Number(vs.weight ?? 0)}>
    ${hasStock ? html`<td><input class=-f data-field=stock type=number step=1 value=${Number(vs.stock ?? 0)}>` : ""}
    <td class=-delete><button class=u2-unstyle u2-confirm><u2-ico icon=delete>✕</u2-ico></button>`);

  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex-grow:0">
    <div class=-head>${t`New product`}</div>
    <form class=-add style="padding:0">
      <table class=u2-table style="white-space:nowrap">
        <tr>
          <th style="width:6em"> ${t`Title`}:
          <td> <input name=title required>
        <tr>
          <th> ${t`Below page`}:
          <td> <input name=parent type=number min=1 required>
        <tr>
          <th>
          <td> <button>${t`create`}</button>
      </table>
    </form>
  </div>

  <div class=u2-card style="flex:1">
    <div class=-head>${t`Products`}</div>
    <div style="overflow:auto; padding:0">
      <table class=u2-table>
        <thead>
          <tr>
            <th> ID
            <th> ${t`Name`}
            <th> ${t`Price`}
            <th> ${t`Weight`}
            ${hasStock ? html`<th> ${await t`Stock`}` : ""}
            <th width=20>
        <tbody>${html.join(trs)}
      </table>
    </div>
  </div>
</div>`;
}

/** One product: what the shop sells it for, and the VAT it carries per country. */
async function renderProduct(node: Node, id: number): Promise<HtmlString> {
  const { app } = node;
  const t = app.t;
  const page = await node.cms.node(id);
  if (!page.exists()) return html.async`<div class=u2-card><div class=-body>${t`Product not found.`}</div></div>`;

  const vs = await app.db.row`SELECT * FROM shp3_product WHERE id = ${id}` ?? {};
  const rates = await app.db.query`SELECT country, rate FROM shp3_product_mwst WHERE product_id = ${id} ORDER BY country`;
  const fields = ["price", "weight", "stock", "stock_is_fix", "stock_trigger"].filter((f) => app.db.table("shp3_product").field(f));

  const rows = fields.map((field) => html`<tr>
    <th>${field}
    <td>${app.db.table("shp3_product").field(field)!.schema.type === "boolean"
      ? html`<input class=-f data-field=${field} type=checkbox ${vs[field] ? html.raw("checked") : ""}>`
      : html`<input class=-f data-field=${field} type=number step=any value="${Number(vs[field] ?? 0)}">`}`);

  const vatRows = rates.map((r) => html`<tr>
    <td>${r.country}
    <td><input class=-vat data-country=${r.country} type=number step=any value=${Number(r.rate)}>
    <td class=-delete><button class=u2-unstyle u2-confirm><u2-ico icon=delete>✕</u2-ico></button>`);

  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:1">
    <div class=-head><a href="?">${t`Products`}</a> — ${await page.title(getCtx().lang) || await page.title(app.languages.def) || page.id}</div>
    <div style="padding:0">
      <table class=u2-table itemid=${id}>${html.join(rows)}</table>
    </div>
  </div>

  <div class=u2-card style="flex-grow:0">
    <div class=-head>${t`VAT rate per country`}</div>
    <div style="padding:0">
      <table class=u2-table itemid=${id}>
        ${html.join(vatRows)}
        <tr class=-new>
          <td><input name=country maxlength=2 size=2 placeholder=CH>
          <td><input name=rate type=number step=any>
          <td><button>${t`add`}</button>
      </table>
    </div>
  </div>
</div>`;
}

export function backendDashboardWidget({ t, db }: App): Promise<HtmlString> {
  const zero = () => 0;
  return html.async`<div style="overflow:auto; padding:0">
<table class=u2-table style="white-space:nowrap">
  <tr><td>${t`Products`}:<td>${db.one`SELECT count(*) FROM shp3_product`.catch(zero)}
  <tr><td>${t`Without a price`}:<td>${db.one`SELECT count(*) FROM shp3_product WHERE price <= ${0}`.catch(zero)}
</table>
</div>`;
}

export const cms = { node: { render, api, js: ["pub/main.js"] } };
