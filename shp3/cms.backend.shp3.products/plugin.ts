import { html, getCtx, sql, tableRef } from "@qino/qino";
import { cms as cmsOf } from "@qino/qino/cms";
import { backend } from "@qino/qino/cms.backend";

import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { HtmlString, App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Products", de: "Produkte" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

/** The product rows the user may read; online or not doesn't matter in the backend. */
async function readable<T extends { id?: unknown }>(app: App, rows: T[]) {
  const ok = await Promise.all(rows.map(async (vs) => await (await cmsOf(app).node(Number(vs.id))).access() > 0));
  return rows.filter((_, i) => ok[i]);
}

function render(node: Node) {
  const id = Number(getCtx().req.query.shp3_productId ?? 0);
  return id ? renderProduct(node, id) : renderList(node);
}

/** All pages with the product module, also those without product row yet (newly created). */
async function renderList(node: Node) {
  const { app } = node;
  const t = app.t;
  const hasStock = !!app.db.table("shp3_product").field("stock"); // shp3.stock adds it
  const module = String(await app.settings.shp3.default_product_module ?? "");

  // The title is in the text table (page.name is internal); joined to avoid a query per row.
  // Untranslated = empty string, not NULL, so COALESCE alone isn't enough.
  const lang = getCtx().lang;
  const rows = await app.db.query`SELECT page.id, page.name, p.price, p.weight ${hasStock ? sql`, p.stock` : sql``},
      COALESCE(NULLIF(t.text, ''), NULLIF(tf.text, ''), page.name) AS title
    FROM page
    LEFT JOIN shp3_product p ON p.id = page.id
    LEFT JOIN ${sql.id(tableRef("text_lang"))} t  ON t.text_id = page.title_id AND t.lang = ${lang}
    LEFT JOIN ${sql.id(tableRef("text_lang"))} tf ON tf.text_id = page.title_id AND tf.lang = ${app.languages.def}
    WHERE page.module = ${module} OR p.id IS NOT NULL
    ORDER BY title`;

  const trs = (await readable(app, rows)).slice(0, 500).map((vs) => html`<tr itemid=${vs.id}>
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
            ${hasStock ? html.async`<th> ${t`Stock`}` : ""}
            <th width=20>
        <tbody>${trs}
      </table>
    </div>
  </div>
</div>`;
}

/** One product: what the shop sells it for, and the VAT it carries per country. */
async function renderProduct(node: Node, id: number) {
  const { app } = node;
  const t = app.t;
  const page = await node.cms.node(id);
  if (!page.exists() || await page.access() < 1) return html.async`<div class=u2-card><div>${t`Product not found.`}</div></div>`;

  const [row, rates] = await Promise.all([
    app.db.row`SELECT * FROM shp3_product WHERE id = ${id}`,
    app.db.query`SELECT country, rate FROM shp3_product_mwst WHERE product_id = ${id} ORDER BY country`,
  ]);
  const vs = row ?? {};
  const table = app.db.table("shp3_product");
  const fields = ["price", "weight", "stock", "stock_is_fix", "stock_trigger"].filter((f) => table.field(f));

  const rows = fields.map((field) => html`<tr>
    <th>${field}
    <td>${table.field(field)!.schema.type === "boolean"
      ? html`<input class=-f data-field=${field} type=checkbox ${vs[field] ? html.raw("checked") : ""}>`
      : html`<input class=-f data-field=${field} type=number step=any value="${Number(vs[field] ?? 0)}">`}`);

  const vatRows = rates.map((r) => html`<tr>
    <td>${r.country}
    <td><input class=-vat data-country=${r.country} type=number step=any value=${Number(r.rate)}>
    <td class=-delete><button class=u2-unstyle u2-confirm><u2-ico icon=delete>✕</u2-ico></button>`);
  const title = await page.title(getCtx().lang) || await page.title(app.languages.def) || page.id;

  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:1">
    <div class=-head><a href="?">${t`Products`}</a> — ${title}</div>
    <div style="padding:0">
      <table class=u2-table itemid=${id}>${rows}</table>
    </div>
  </div>

  <div class=u2-card style="flex-grow:0">
    <div class=-head>${t`VAT rate per country`}</div>
    <div style="padding:0">
      <table class=u2-table itemid=${id}>
        ${vatRows}
        <tr class=-new>
          <td><input name=country maxlength=2 size=2 placeholder=CH>
          <td><input name=rate type=number step=any>
          <td><button>${t`add`}</button>
      </table>
    </div>
  </div>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const { t, db } = app;
  const products = await readable(app, await db.query`SELECT id, price FROM shp3_product`.catch(() => []));
  return html.async`<div style="overflow:auto; padding:0">
<table class=u2-table style="white-space:nowrap">
  <tr><td>${t`Products`}:<td>${products.length}
  <tr><td>${t`Without a price`}:<td>${products.filter((p) => Number(p.price) <= 0).length}
</table>
</div>`;
}

export const cms = { node: { render, api, js: ["pub/main.js"] } };
