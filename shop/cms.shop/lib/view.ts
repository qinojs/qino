import { html } from "@qino/qino";

import { shopT } from "./shop.ts";

import type { HtmlString } from "@qino/qino";
import type { Order } from "./rows.ts";

/** An order as a table: its lines, what the shop added, tax and total. For the backend and the customer. */
export async function orderTable(order: Order): Promise<HtmlString> {
  const t = shopT(order.$app), currency = await order.currencyRow();
  const money = (v: number) => currency?.format(v) ?? String(v);
  const { rates, total } = await order.totals();
  return html.async`<table class=u2-table>
  <thead><tr>
    <th>${t`Article`}
    <th>${t`Quantity`}
    <th>${t`Price`}
    <th>${t`Total`}
  <tbody>${(await order.lines()).map(async (l) => html.async`<tr>
    <td>${l.name}${(await l.describe()).split("\n").filter(Boolean).map((d) => html`<div class=-description>${d}</div>`)}
    <td>${Number(l.quantity)}
    <td>${money(Number(l.price))}
    <td>${money(l.total())}`)}
  <tbody>${(await order.extras()).map((x) => html`<tr>
    <td colspan=3>${x.name}
    <td>${money(x.price)}`)}
  <tfoot>
    ${rates.filter((r) => r.rate).map((r) => html.async`<tr><th colspan=3>${t`VAT`} ${r.rate}%<td>${money(r.tax)}`)}
    <tr><th colspan=3>${t`Total`} ${order.currency}<td>${money(order.status === "cart" ? total : Number(order.total))}
</table>`;
}
