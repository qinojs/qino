import { html, sql, sqlSearch } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { refOf, shopT } from "@qino/qino/cms.shop";

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
  const q = (key: string) => url.searchParams.get(key) ?? "";
  const search = sqlSearch(q("search"), ["bill", "ship"], { exact: ["id"] });
  const where = [sql`status <> ${"cart"}`, search.where, q("status") ? sql`status = ${q("status")}` : null].filter(w => w != null);
  const page = Math.max(0, Number(q("page")) || 0);
  const orders = await app.db.table("shop_order").all<Order>`WHERE ${sql.join(where, " AND ")} ORDER BY id DESC LIMIT ${PER_PAGE + 1} OFFSET ${page * PER_PAGE}`;
  const more = orders.length > PER_PAGE, names = await labels(app);
  const link = (params: Record<string, unknown>) => backend.toUrl(url.pathname, { search: q("search"), status: q("status"), ...params });
  return html.async`<div class=u2-card>
  <div class=-head>${t`Orders`}</div>
  <form method=get>
    <input type=search name=search value="${q("search")}" placeholder="${t`Number, name, address`}">
    <select name=status>${option("", t`Any status`, q("status"))}${STATUSES.map((s) => option(s, names[s], q("status")))}</select>
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
    <tbody>${orders.slice(0, PER_PAGE).map((o) => html.async`<tr>
      <td><a href="${link({ order: o.$id })}">${o.$id}</a>
      <td>${date(o.ordered)}
      <td>${o.party("bill")?.name}
      <td>${o.country}
      <td>${o.currency} ${(Number(o.total) / 100).toFixed(2)}
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
  if (!order || order.status === "cart") return html.async`<div class=u2-card><div>${t`Not found.`}</div></div>`;
  const currency = await order.currencyRow();
  const money = (v: number) => currency?.format(v) ?? (v / 100).toFixed(2);
  const { rates } = await order.totals();
  const invoice = await app.db.row`SELECT id, number, status FROM invoice WHERE ref = ${refOf(id)} ORDER BY id DESC`.catch(() => undefined);
  return html.async`<div class=u2-flex data-order="${id}">
  <div class=u2-card>
    <div class=-head>${t`Order`} ${id} · ${(await labels(app))[order.status] ?? order.status}</div>
    <table class=u2-table>
      <thead><tr>
        <th>${t`Article`}
        <th>${t`Quantity`}
        <th>${t`Price`}
        <th>${t`Total`}
      <tbody>${(await order.lines()).map((l) => html`<tr>
        <td>${l.name}${String(l.description ?? "").split("\n").filter(Boolean).map((d) => html`<br><small>${d}</small>`)}
        <td>${Number(l.quantity)}
        <td>${money(Number(l.price))}
        <td>${money(l.total())}`)}
      <tbody>${(await order.extras()).map((x) => html`<tr>
        <td colspan=3>${x.name}
        <td>${money(x.price)}`)}
      <tfoot>
        ${rates.filter((r) => r.rate).map((r) => html.async`<tr><th colspan=3>${t`VAT`} ${r.rate}%<td>${money(r.tax)}`)}
        <tr><th colspan=3>${t`Total`} ${order.currency}<td><b>${money(Number(order.total))}</b>
    </table>
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
      ${order.status !== "canceled" ? html.async`<button data-status=canceled u2-confirm>${t`Cancel`}</button>` : ""}
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
