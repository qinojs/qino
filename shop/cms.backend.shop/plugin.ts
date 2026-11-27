import { html, sql, unixTime } from "@qino/qino";
import { backend, renderDashboard } from "@qino/qino/cms.backend";
import { currency, shopT } from "@qino/qino/cms.shop";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Order, Product } from "@qino/qino/cms.shop";

const { name } = manifest;
const LIST = 30;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Shop", de: "Shop" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

/** Orders waiting for payment and what came in during the last 30 days, per currency. */
async function figures(app: App): Promise<HtmlString> {
  const t = shopT(app), month = unixTime() - 30 * 86400;
  const [open, sold] = await Promise.all([
    app.db.one`SELECT COUNT(*) FROM shop_order WHERE status = ${"ordered"}`.then(Number),
    app.db.query`SELECT currency, COUNT(*) AS n, SUM(total) AS total FROM shop_order
      WHERE status IN ('ordered', 'paid') AND ordered > ${month} GROUP BY currency ORDER BY currency`,
  ]);
  return html.async`<table class=u2-table>
    <tr><th>${t`Waiting for payment`}<td>${open}
    ${sold.map(async (r) => html.async`<tr><th>${r.currency}, 30 ${t`days`}<td>${Number(r.n)} / ${(await currency(app, String(r.currency)))?.format(Number(r.total)) ?? r.total}`)}
  </table>`;
}

/** A short list that leads to a backend page of the shop, if that page is there. */
async function card(node: Node, module: string, title: Promise<string>, rows: (url: string) => Promise<HtmlString[]>): Promise<HtmlString | string> {
  const target = await node.cms.nodeByModule(module);
  if (!target) return "";
  const url = await target.url();
  return html.async`<div class=u2-card>
    <div class=-head><a href="${url}">${title}</a></div>
    <div style="overflow:auto; max-height:25rem; padding:0"><table class=u2-table><tbody>${rows(url)}</table></div>
  </div>`;
}

function newestOrders(app: App, url: string): Promise<HtmlString[]> {
  return app.db.table("shop_order").all<Order>`WHERE status <> ${"cart"} ORDER BY ordered DESC LIMIT ${LIST}`.then((orders) => Promise.all(orders.map(async (o) => html`<tr u2-href>
    <td><a href="${backend.toUrl(url, { id: o.$id })}">${o.$id}</a>
    <td>${o.party("bill")?.name}
    <td>${(await o.currencyRow())?.show(Number(o.total)) ?? o.total}`)));
}

async function bestsellers(app: App, url: string): Promise<HtmlString[]> {
  const rows = await app.db.query`SELECT l.product_id, MIN(l.name) AS name, SUM(l.quantity) AS sold FROM shop_order_line l
    JOIN shop_order o ON o.id = l.order_id WHERE o.status <> ${"cart"} AND l.${sql.id("key")} = ${""} AND l.product_id IS NOT NULL
    GROUP BY l.product_id ORDER BY sold DESC LIMIT ${LIST}`;
  return rows.map((r) => html`<tr u2-href><td>${Number(r.sold)} ×<td><a href="${backend.toUrl(url, { id: r.product_id })}">${r.name}</a>`);
}

async function latestProducts(app: App, url: string): Promise<HtmlString[]> {
  const products = await app.db.table("shop_product").all<Product>`ORDER BY id DESC LIMIT ${LIST}`;
  return Promise.all(products.map(async (p) => html`<tr u2-href><td><a href="${backend.toUrl(url, { id: p.$id })}">${await p.title(app.languages.def)}</a>`));
}

function render(node: Node): Promise<HtmlString> {
  const app = node.app, t = shopT(app);
  return html.async`<div class=u2-flex>
  <div class=u2-card>
    <div class=-head>${t`Now`}</div>
    ${figures(app)}
  </div>
  ${card(node, "cms.backend.shop.orders", t`Newest orders`, (url) => newestOrders(app, url))}
  ${card(node, "cms.backend.shop.products", t`Sold most`, (url) => bestsellers(app, url))}
  ${card(node, "cms.backend.shop.products", t`Latest products`, (url) => latestProducts(app, url))}
  ${renderDashboard(node)}
</div>`;
}

export const cms = { node: { render } };
/** For the backend dashboard: the figures, and the latest placed orders that are not canceled. */
async function backendDashboardWidget(app: App, page: Node): Promise<HtmlString> {
  const t = shopT(app);
  const target = await page.cms.nodeByModule("cms.backend.shop.orders");
  const url = target ? await target.url() : "";
  const orders = await app.db.table("shop_order").all<Order>`WHERE status IN ('ordered', 'paid') ORDER BY ordered DESC LIMIT 5`;
  const status: Record<string, Promise<string>> = { ordered: t`Ordered`, paid: t`Paid` };
  return html.async`${figures(app)}
  ${orders.length ? html.async`<table class=u2-table style="white-space:nowrap; margin-top:1px">
    <thead><tr><th>${t`Order`}<th><th><th>
    <tbody>${orders.map(async (o) => html.async`<tr u2-href>
      <td>${url ? html`<a href="${backend.toUrl(url, { id: o.$id })}">${o.$id}</a>` : o.$id}
      <td>${o.party("bill")?.name}
      <td>${(await o.currencyRow())?.show(Number(o.total)) ?? o.total}
      <td>${status[o.status]}`)}
  </table>` : ""}`;
}

export { backendDashboardWidget };
