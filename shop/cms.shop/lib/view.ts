import { html } from "@qino/qino";

import { cart } from "./cart.ts";
import { shopT } from "./shop.ts";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Order } from "./rows.ts";

/** An order as a table: its lines, what the shop added, tax and total. For the backend and the customer. */
export async function orderTable(order: Order): Promise<HtmlString> {
  const t = shopT(order.$app), currency = await order.currencyRow();
  const money = (v: number) => currency?.format(v) ?? v;
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

const methodSettings = {
  properties: {
    heading: { type: "string", default: "2", description: "Level of the heading (1–6), or no for none." },
    editable: { type: "boolean", default: true, description: "The method can be chosen here; else only the chosen one is shown." },
  },
};

/** A checkout step that chooses a method: those that fit the cart, as the PHP modules showed them.
 *  Delivery says what it costs; `title` is the heading a new page starts with. */
export function methodStep(what: "shipping" | "payment", title: Record<string, string>) {
  const render = async (node: Node, { ctx }: { ctx: Ctx }) => {
    const order = await cart(ctx, false), ships = what === "shipping";
    const methods = order ? await (ships ? order.shippings() : order.payments()) : [];
    if (!order || !methods.length) return html`<form></form>`;
    const [active, currency] = await Promise.all([ships ? order.activeShipping() : order.activePayment(), order.currencyRow()]);
    const edit = await node.settings.editable() !== false;
    const heading = String(await node.settings.heading() ?? "2");
    const items = methods.filter((m) => edit || m.name === active).map((m) => html.async`<label>
        ${edit ? html`<span><input required type=radio name=method value="${m.name}" ${m.name === active ? html`checked` : ""}></span>` : ""}
        <span><span>${m.label}</span>
          ${ships ? order.shippingCost(m.name).then((cost) => currency?.show(cost)) : ""}</span>
      </label>`);
    return html.async`<form shop-choose=${what}>
  ${heading === "no" ? "" : node.cms.text(node, "title", { tag: `h${heading}`, initial: title })}
  <div class=-options>${items}</div>
</form>`;
  };
  return { render, js: ["../cms.shop/pub/shop.js"], settingsSchema: methodSettings };
}
