import { html, type HtmlString, getCtx, sql, type App } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { backend } from "../../module/cms.backend/mod.ts";
import { mainCurrency, type Order } from "../shp3/mod.ts";

export const name = "cms.backend.shp3.orders1";
export const description = "Lists the shop's orders and shows what is in them.";
export const needs = ["cms.backend", "shp3"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Orders", de: "Bestellungen" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

const showTime = (t: number) => t ? new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") : "";

function render(node: Node): Promise<HtmlString> {
  const id = Number(getCtx().req.query.shp3_orderId ?? 0);
  return id ? renderOrder(node, id) : renderList(node);
}

async function renderList(node: Node): Promise<HtmlString> {
  const { app } = node;
  const t = app.t;
  const open = getCtx().req.query.shp3_open !== undefined;
  const currency = await mainCurrency(app.db);

  const rows = await app.db.query`SELECT o.*, u.email FROM shp3_order o
    LEFT JOIN usr u ON u.id = o.usr_id
    WHERE ${open ? sql`o.time_ordered = ${0}` : sql`o.time_ordered > ${0}`}
    ORDER BY o.id DESC LIMIT 200`;

  const trs = rows.map((vs) => html`<tr itemid=${vs.id}>
    <td><a href="?shp3_orderId=${vs.id}">${vs.id}</a>
    <td>${showTime(Number(vs.time_ordered))}
    <td>${vs.email ?? ""}
    <td>${vs.payment ?? ""}
    <td>${vs.shipping ?? ""}
    <td>${currency?.format(Number(vs.cost)) ?? vs.cost} ${vs.currency ?? ""}
    <td>${Number(vs.paid) >= Number(vs.cost) && Number(vs.cost) > 0 ? html`<u2-ico icon=check>✓</u2-ico>` : ""}`);

  return html.async`<div class=u2-card>
  <div class=-head>
    ${open ? t`Open carts` : t`Orders`}
    <a href="?${open ? "" : "shp3_open"}">${open ? t`Orders` : t`Open carts`}</a>
  </div>
  <div style="overflow:auto; padding:0">
    <table class=u2-table>
      <thead>
        <tr>
          <th> ID
          <th> ${t`Ordered`}
          <th> ${t`Customer`}
          <th> ${t`Payment`}
          <th> ${t`Shipping`}
          <th> ${t`Total`}
          <th width=20> ${t`Paid`}
      <tbody>${html.join(trs)}
    </table>
  </div>
</div>`;
}

async function renderOrder(node: Node, id: number): Promise<HtmlString> {
  const { app } = node;
  const t = app.t;
  const order = await app.db.table("shp3_order").get<Order>(id);
  if (!order) return html.async`<div class=u2-card><div class=-body>${t`Order not found.`}</div></div>`;

  const currency = await order.currencyRow();
  const money = (v: number) => currency?.format(v) ?? v;
  const costs = await order.costs();

  const lines: HtmlString[] = [];
  for (const item of await order.items()) {
    lines.push(html`<tr>
      <td>${item.title}
      <td>${item.quantity}
      <td>${money(item.onePrice())}
      <td>${money(item.rowPrice())}`);
  }
  for (const g of await order.generatedItems()) {
    lines.push(html`<tr class=-generated><td>${g.title || g.name}<td><td><td>${money(g.price)}`);
  }

  const email = await app.db.one`SELECT email FROM usr WHERE id = ${order.usr_id}`;

  return html.async`<div class=u2-card>
  <div class=-head><a href="?">${t`Orders`}</a> — ${t`Order`} ${order.id}</div>
  <div class=-body>
    <table class=u2-table>
      <tr><th>${t`Ordered`}<td>${showTime(order.time_ordered)}
      <tr><th>${t`Customer`}<td>${email ?? ""}
      <tr><th>${t`Payment`}<td>${order.payment}
      <tr><th>${t`Shipping`}<td>${order.shipping}
      <tr><th>${t`Paid`}<td>${money(Number(order.paid))}
    </table>
    <table class=u2-table>
      <thead>
        <tr><th>${t`Article`}<th>${t`Quantity`}<th>${t`Price`}<th>${t`Total`}
      <tbody>${html.join(lines)}
      <tfoot>
        <tr><th colspan=3>${t`Total`}<td>${money(costs.gross)}
    </table>
  </div>
</div>`;
}

export const cms = { node: { render } };
