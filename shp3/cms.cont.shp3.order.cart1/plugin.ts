import { html } from "@qino/qino";
import { cart } from "@qino/qino/shp3";

import type { HtmlString, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    editable: { type: "boolean", default: true, description: "Whether quantities can be changed here." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  const order = await cart(ctx, false);
  const items = order ? await order.items() : [];
  if (!items.length) return html.async`<div>${t`Your cart is empty`}</div>`;

  const editable = (await node.settings.editable()) !== false;
  const currency = await order!.currencyRow();
  const money = (v: number) => currency?.format(v) ?? v;
  const costs = await order!.costs();

  const rows: HtmlString[] = [];
  for (const item of items) {
    const errors = Object.values(await item.errors());
    rows.push(html`<tr itemid=${item.id}>
      <td class=-title>${item.title}<div class=-options>${await item.calcDescription()}</div>
        ${errors.length
          ? html`<div class=-errors>${errors.map((e) => html`<div>${e}</div>`)}
            <button class=-resolve>${await t`Fix`}</button></div>`
          : ""}
      <td class=-quantity>${editable
        ? html`<input type=number min=0 step=1 value=${item.quantity} class=-q>`
        : item.quantity}
      <td class=-price>${money(item.onePrice())}
      <td class=-total>${money(item.rowPrice())}
      ${editable ? html`<td class=-rem><button class=u2-unstyle u2-confirm><u2-ico icon=delete>✕</u2-ico></button>` : ""}`);
  }

  // Shipping and friends are lines of their own — they are in the total, so they have to be seen.
  const generated = (await order!.generatedItems()).map((item) => html`<tr>
      <td class=-title colspan=2>${item.title || item.name}
      <td class=-price>
      <td class=-total>${money(item.price)}
      ${editable ? html`<td>` : ""}`);

  const taxes: HtmlString[] = [];
  for (const [rate, value] of Object.entries(costs.taxes)) {
    taxes.push(html`<tr class=-tax>
      <th colspan=3>${await t`VAT`} ${rate}%
      <td>${money(value)}
      ${editable ? html`<td>` : ""}`);
  }

  return html.async`<div>
  <table class=u2-table>
    <thead>
      <tr>
        <th>${t`Article`}
        <th>${t`Quantity`}
        <th>${t`Price`}
        <th>${t`Total`}
        ${editable ? html`<th width=20>` : ""}
    <tbody class=-items>${rows}
    <tbody class=-generated>${generated}
    <tfoot>
      <tr class=-net>
        <th colspan=3>${t`Subtotal`}
        <td>${money(costs.net)}
        ${editable ? html`<td>` : ""}
  	  ${taxes}
      <tr class=-gross>
        <th colspan=3>${t`Total`}
        <td class=-sum>${money(costs.gross)}
        ${editable ? html`<td>` : ""}
  </table>
</div>`;
}

export const cms = { node: { render, js: ["../shp3/pub/shp3.js", "pub/main.js"], settingsSchema } };
