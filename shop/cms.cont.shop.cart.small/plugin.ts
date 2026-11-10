import { html } from "@qino/qino";
import { cart, shopT } from "@qino/qino/cms.shop";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    mode: { type: "string", enum: ["short", "count", "lines"], default: "short", description: "How much of the cart to show: the count, the count and the sum, or the lines." },
    cart: { type: "integer", minimum: 1, description: "Page it links to; none: no link." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = shopT(node.app);
  const order = await cart(ctx, false);
  const lines = order ? await order.lines() : [];
  if (!lines.length) return html.async`<div class=-empty>${t`Your cart is empty`}</div>`;

  const currency = await order!.currencyRow();
  const money = (v: number) => currency?.show(v) ?? v;
  const { total } = await order!.totals();
  const mode = String(await node.settings.mode() ?? "short");
  const page = Number(await node.settings.cart() || 0);
  const url = page ? await (await node.cms.node(page)).url() : "";

  const body = mode === "lines"
    ? html.async`<table>${lines.map((line) => html`<tr>
        <td class=-title>${line.name}
        <td class=-quantity>${Number(line.quantity)}
        <td class=-cost>${money(line.total())}`)}
      <tfoot><tr class=-total>
        <th colspan=2>${t`Total`}
        <td>${money(total)}
    </table>`
    : mode === "count"
    ? html`<span class=-num>${lines.length}</span> <span class=-cost>${money(total)}</span>`
    : html`<span class=-num>${lines.length}</span>`;

  return html.async`<div>${url ? html.async`<a href="${url}">${body}</a>` : body}</div>`;
}

export const cms = { node: { render, js: ["../cms.shop/pub/shop.js", "pub/main.js"], settingsSchema } };
