import { html, type HtmlString, sql, type App } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { backend } from "../../module/cms.backend/mod.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.shp3.products";
export const description = "Lists the shop's products with their price, weight and stock.";
export const needs = ["cms.backend", "shp3"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Products", de: "Produkte" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

/** Every page using the product module is listed — also one whose product row is still missing,
 *  which is exactly the page an editor just created in the tree. */
async function render(node: Node): Promise<HtmlString> {
  const { app } = node;
  const t = app.t;
  const hasStock = !!app.db.table("shp3_product").field("stock"); // shp3.stock adds it
  const module = String(await app.settings.shp3.default_product_module ?? "");

  const rows = await app.db.query`SELECT page.id, page.name, p.price, p.weight ${hasStock ? sql`, p.stock` : sql.raw("")}
    FROM page LEFT JOIN shp3_product p ON p.id = page.id
    WHERE page.module = ${module} OR p.id IS NOT NULL
    ORDER BY page.name LIMIT 500`;

  const trs = rows.map((vs) => html`<tr itemid=${vs.id}>
    <td>${vs.id}
    <td>${vs.name ?? ""}
    <td><input class=-f data-field=price type=number step=any value=${Number(vs.price ?? 0)}>
    <td><input class=-f data-field=weight type=number step=any value=${Number(vs.weight ?? 0)}>
    ${hasStock ? html`<td><input class=-f data-field=stock type=number step=1 value=${Number(vs.stock ?? 0)}>` : ""}`);

  return html.async`<div class=u2-card>
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
      <tbody>${html.join(trs)}
    </table>
  </div>
</div>`;
}

export const cms = { node: { render, api, js: ["pub/main.js"] } };
