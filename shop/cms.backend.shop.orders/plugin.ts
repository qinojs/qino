import { html, sql, sqlSearch } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { orderTable, refOf, shopT } from "@qino/qino/cms.shop";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Order, Party, Status } from "@qino/qino/cms.shop";

const { name } = manifest;
const STATUSES: Status[] = ["ordered", "paid", "canceled"];
const PER_PAGE = 100;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Orders", de: "Bestellungen" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

const option = (value: string, label: unknown, current: string) =>
  html.async`<option value="${value}" ${value === current ? html`selected` : ""}>${label}`;
const party = (p?: Party) => p ? [p.organization, p.name !== p.organization ? p.name : "", p.address?.streetAddress, [p.address?.postalCode, p.address?.addressLocality].filter(Boolean).join(" "), p.address?.addressCountry, p.email, p.telephone].filter(Boolean).map((v) => html`${v}<br>`) : "";
const labels = async (app: App): Promise<Record<string, string>> =>
  ({ ordered: await shopT(app)`Ordered`, paid: await shopT(app)`Paid`, canceled: await shopT(app)`Canceled` });
const date = (time: unknown) => Number(time) ? new Date(Number(time) * 1000).toISOString().slice(0, 16).replace("T", " ") : "";

function render(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const url = ctx.req.url.toURL();
  const id = Number(vars.order ?? url.searchParams.get("order")); // a reload has its own address
  return Number.isSafeInteger(id) && id > 0 ? detail(node, id) : list(node, url);
}

/** Placed orders, newest first: search over number, names and addresses, filter by status. */
async function list(node: Node, url: URL): Promise<HtmlString> {
  const app = node.app, t = shopT(app);
  const self = await (await node.page()).url();
  const q = (key: string) => url.searchParams.get(key) ?? "";
  const search = sqlSearch(q("search"), ["bill", "ship"], { exact: ["id"] });
  const carts = q("status") === "cart", time = sql.id(carts ? "created" : "ordered");
  const day = (key: string) => Date.parse(q(key)) / 1000; // NaN without a date
  const where = [
    carts ? sql`status = ${"cart"}` : sql`status <> ${"cart"}`, search.where, q("status") && !carts ? sql`status = ${q("status")}` : null,
    day("from") ? sql`${time} >= ${day("from")}` : null, day("to") ? sql`${time} < ${day("to") + 86400}` : null,
  ].filter(w => w != null);
  const page = Math.max(0, Number(q("page")) || 0);
  const orders = await app.db.table("shop_order").all<Order>`WHERE ${sql.join(where, " AND ")} ORDER BY id DESC LIMIT ${PER_PAGE + 1} OFFSET ${page * PER_PAGE}`;
  const more = orders.length > PER_PAGE, names = await labels(app);
  const link = (params: Record<string, unknown>) => backend.toUrl(url.pathname + url.search, { search: q("search"), status: q("status"), from: q("from"), to: q("to"), ...params });
  return html.async`<div class=u2-card>
  <div class=-head>${t`Orders`}</div>
  <form method=get action="${self}">${backend.toFields(self)}
    <input type=search name=search value="${q("search")}" placeholder="${t`Number, name, address`}">
    <select name=status>${option("", t`Any status`, q("status"))}${STATUSES.map((s) => option(s, names[s], q("status")))}${option("cart", t`Open carts`, q("status"))}</select>
    <label>${t`From`} <input type=date name=from value="${q("from")}"></label>
    <label>${t`Until`} <input type=date name=to value="${q("to")}"></label>
    <button>${t`Filter`}</button>
  </form>
  <table class=u2-table>
    <thead><tr>
      <th>${t`No.`}
      <th>${t`Ordered`}
      <th>${t`Customer`}
      <th>${t`Country`}
      <th>${t`Total`}
      <th>${t`Status`}
    <tbody>${orders.slice(0, PER_PAGE).map(async (o) => html.async`<tr>
      <td><a href="${link({ order: o.$id })}">${o.$id}</a>
      <td>${date(carts ? o.created : o.ordered)}
      <td>${o.party("bill")?.name}
      <td>${o.country}
      <td>${(await o.currencyRow())?.show(carts ? (await o.totals()).total : Number(o.total)) ?? o.total}
      <td>${names[o.status] ?? o.status}`)}
  </table>
  <div>
    ${page ? html.async`<a href="${link({ page: page - 1 })}">${t`Newer`}</a>` : ""}
    ${more ? html.async`<a href="${link({ page: page + 1 })}">${t`Older`}</a>` : ""}
  </div>
</div>`;
}

/** One order as it was placed: lines, what the shop added, totals, parties, and what to do with it. */
async function detail(node: Node, id: number): Promise<HtmlString> {
  const app = node.app, t = shopT(app);
  const order = await app.db.table("shop_order").get<Order>(id);
  if (!order) return html.async`<div class=u2-card><div>${t`Not found.`}</div></div>`;
  const invoice = await app.db.row`SELECT id, number, status FROM invoice WHERE ref = ${refOf(id)} ORDER BY id DESC`;
  return html.async`<div class=u2-flex data-order="${id}">
  <div class=u2-card>
    <div class=-head>${t`Order`} ${id} · ${(await labels(app))[order.status] ?? order.status}</div>
    ${orderTable(order)}
  </div>
  <div class=u2-card>
    <div class=-head>${t`Customer`}</div>
    <div>
      <b>${t`Billing address`}</b><br>${party(order.party("bill"))}
      ${order.ship ? html.async`<br><b>${t`Delivery address`}</b><br>${party(order.party("ship"))}` : ""}
    </div>
    <table class=u2-table>
      <tr><th>${t`Ordered`}<td>${date(order.ordered)}
      <tr><th>${t`Delivery`}<td>${order.shipping}
      <tr><th>${t`Payment`}<td>${order.payment}
      ${invoice ? html.async`<tr><th>${t`Invoice`}<td>${invoice.number} · ${invoice.status}` : ""}
    </table>
    <div>
      ${order.status === "ordered" ? html.async`<button data-status=paid>${t`Mark as paid`}</button>` : ""}
      ${order.status !== "canceled" && order.status !== "cart" ? html.async`<button data-status=canceled u2-confirm>${t`Cancel`}</button>` : ""}
    </div>
  </div>
</div>`;
}

/** Node access is the permission: whoever may open this page may move an order on. */
async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const status = String(vars.status ?? "") as Status;
  if (!STATUSES.includes(status)) return null;
  const order = await node.app.db.table("shop_order").get<Order>(vars.order);
  if (!order || order.status === "cart") return { ok: false };
  await order.setStatus(status);
  return { ok: true };
}

export const cms = { node: { render, api, js: ["pub/main.js"] } };
