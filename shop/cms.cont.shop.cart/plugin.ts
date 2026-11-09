import { html } from "@qino/qino";
import { cart, shopT } from "@qino/qino/cms.shop";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    editable: { type: "boolean", default: true, description: "Quantities can be changed here." },
    next: { type: "integer", description: "Page of the checkout: a button below the total leads there; none: no button." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = shopT(node.app);
  const order = await cart(ctx, false);
  if (order) await order.reprice(); // prices as they are now
  const lines = order ? await order.lines() : [];
  if (!lines.length) return html.async`<div class=-empty>${t`Your cart is empty`}</div>`;

  const editable = await node.settings.editable() !== false;
  const currency = await order!.currencyRow();
  const money = (v: number) => currency?.format(v) ?? String(v);
  const { rates, total } = await order!.totals();
  const cell = editable ? html`<td>` : "";
  const next = Number(await node.settings.next() || 0);

  const rows: Promise<HtmlString>[] = [];
  for (const line of lines) {
    const errors = Object.values(await line.errors()), solutions = Object.entries(await line.solutions());
    rows.push(html.async`<tr data-line="${line.id}">
      <td class=-title>${line.name}<div class=-description>${(await line.describe()).split("\n").map((d) => html`<div>${d}</div>`)}</div>
        ${errors.length ? html`<div class=-errors>${errors.map((e) => html`<div>${e}</div>`)}${solutions.map(([id, s]) => html`<button type=button class=-solve data-solution="${id}">${s.label}</button>`)}</div>` : ""}
      <td class=-quantity>${editable ? html.async`<input type=number min=0 step=1 value="${line.quantity}" aria-label="${t`Quantity`}">` : line.quantity}
      <td class=-price>${money(line.price)}
      <td class=-total>${money(line.total())}
      ${editable ? html.async`<td><button class=u2-unstyle u2-confirm aria-label="${t`Remove`}"><u2-ico icon=delete>✕</u2-ico></button>` : ""}`);
  }
  // shipping and surcharges are lines of their own: they are in the total, so they are shown
  const extras = (await order!.extras()).map((x) => html`<tr class=-extra>
      <td class=-title colspan=3>${x.name}
      <td class=-total>${money(x.price)}
      ${cell}`);
  const taxes = rates.filter((r) => r.rate).map((r) => html.async`<tr class=-tax>
      <th colspan=3>${t`VAT`} ${r.rate}%
      <td>${money(r.tax)}
      ${cell}`);

  return html.async`<div>
  <table class=u2-table>
    <thead><tr>
      <th>${t`Article`}
      <th>${t`Quantity`}
      <th>${t`Price`}
      <th>${t`Total`}
      ${editable ? html`<th>` : ""}
    <tbody class=-lines>${rows}
    <tbody class=-extras>${extras}
    <tfoot>
      ${taxes}
      <tr class=-sum>
        <th colspan=3>${t`Total`} ${currency?.$id}
        <td>${money(total)}
        ${cell}
  </table>
  ${next ? html.async`<a class=-next href="${(await node.cms.node(next)).url()}"><button type=button>${node.cms.text(node, "next", { tag: "span", initial: { de: "Zur Kasse", en: "Checkout" } })}</button></a>` : ""}
</div>`;
}

export const cms = { node: { render, js: ["../cms.shop/pub/shop.js", "pub/main.js"], settingsSchema } };
