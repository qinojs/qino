import { hee } from "@qino/qino";
import { mail } from "@qino/qino/mail";
import { shp3 } from "@qino/qino/shp3";

import type { App } from "@qino/qino";
import type { Order } from "@qino/qino/shp3";

export const settingsSchema = {
  properties: {
    on_order: {
      properties: {
        receivers: { type: "string", description: "Shop addresses that get a copy, comma separated." },
        to_client: { type: "boolean", default: true, description: "Whether the customer gets the confirmation." },
      },
    },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // The order is placed and saved by now. A mail that cannot go out is worth a log line,
  // never a failed checkout for a customer whose order went through.
  shp3(app).on("ordered", ({ order }) =>
    confirm(app, order).catch((e) => console.error(`shp3.messages2: order ${order.$id} not confirmed:`, e)), { signal });
}

async function confirm(app: App, order: Order) {
  const settings = app.settings["shp3.messages2"].on_order;
  const to = String(await settings.receivers ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const client = String(order.$get("bill_email") ?? ""); // the address module owns that column
  if (await settings.to_client !== false && client) to.push(client);
  if (!to.length) return;

  const msg = await mail(app).create({
    subject: `${await app.t`Your order`} ${order.$id}`,
    html: await body(app, order),
  });
  for (const email of to) msg.addTo(email);
  await msg.send();
}

/** Mail HTML is its own world: no stylesheet reaches it, so the few functional rules are inline. */
async function body(app: App, order: Order) {
  const t = app.t;
  const currency = await order.currencyRow();
  const money = (v: number) => currency ? currency.format(v) : String(v);
  const costs = await order.costs();
  const right = ' style="text-align:right"';

  const lines: string[] = [];
  for (const item of await order.items()) {
    lines.push(`<tr>
      <td>${hee(item.title)}<br>${hee(await item.calcDescription())}
      <td${right}>${item.quantity}
      <td${right}>${money(item.onePrice())}
      <td${right}>${money(item.rowPrice())}`);
  }
  for (const item of await order.generatedItems()) {
    lines.push(`<tr>
      <td>${hee(item.title || item.name)}
      <td${right}>
      <td${right}>
      <td${right}>${money(item.price)}`);
  }

  const vat = hee(await t`VAT`);
  const taxes = Object.entries(costs.taxes).map(([rate, value]) =>
    `<tr><td>${vat} ${rate}%<td${right}><td${right}><td${right}>${money(value)}`);

  return `<h2>${hee(await t`Your order`)} ${order.$id}</h2>
<p>${hee(await t`Thank you for your order.`)}</p>
<table>
  <thead>
    <tr>
      <th>${hee(await t`Article`)}
      <th${right}>${hee(await t`Quantity`)}
      <th${right}>${hee(await t`Price`)}
      <th${right}>${hee(await t`Total`)}
  <tbody>${lines.join("")}
  <tfoot>
    <tr><td>${hee(await t`Subtotal`)}<td${right}><td${right}><td${right}>${money(costs.net)}
    ${taxes.join("")}
    <tr><td><b>${hee(await t`Total`)}</b><td${right}><td${right}><td${right}><b>${currency ? currency.show(costs.gross) : costs.gross}</b>
</table>
${await addresses(app, order)}`;
}

async function addresses(app: App, order: Order) {
  const t = app.t;
  const block = (side: "bill" | "ship") => [
    order.$get(`${side}_company`),
    [order.$get(`${side}_firstname`), order.$get(`${side}_lastname`)].filter(Boolean).join(" "),
    order.$get(`${side}_street`),
    [order.$get(`${side}_country`), order.$get(`${side}_zip`), order.$get(`${side}_city`)].filter(Boolean).join(" "),
    order.$get(`${side}_phone`),
    order.$get(`${side}_email`),
  ].filter(Boolean).map((line) => hee(line)).join("<br>");

  const bill = block("bill");
  if (!bill) return "";
  const ship = order.ship_unlike_bill ? block("ship") : "";
  return `<table>
  <tr>
    <td><b>${hee(await t`Billing address`)}</b><br>${bill}
    ${ship ? `<td><b>${hee(await t`Delivery address`)}</b><br>${ship}` : ""}
</table>`;
}
