import { html } from "@qino/qino";
import { cart } from "@qino/qino/shp3";

import type { HtmlString, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    mode: { type: "string", enum: ["short", "count", "lines"], default: "short", description: "How much of the cart to show." },
    cart_page: { type: "integer", minimum: 1, description: "Page the cart links to." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  const order = await cart(ctx, false);
  const items = order ? await order.items() : [];
  if (!items.length) return html.async`<div class=-empty>${t`Your cart is empty`}</div>`;

  const currency = await order!.currencyRow();
  const money = (v: number) => currency ? currency.show(v) : v;
  const costs = await order!.costs();
  const mode = String(await node.settings.mode() ?? "short");
  const pageId = Number(await node.settings.cart_page());
  const url = pageId ? await (await node.cms.node(pageId)).url() : "";

  const body = mode === "lines"
    ? html`<table>${items.map((item) => html`<tr itemid=${item.id}>
        <td class=-title>${item.title}
        <td class=-quantity>${item.quantity}
        <td class=-cost>${money(item.rowPrice())}`)}
      <tfoot><tr class=-total>
        <th colspan=2>${await t`Total`}
        <td>${money(costs.gross)}
    </table>`
    : mode === "count"
    ? html`<span class=-num>${items.length}</span> <span class=-cost>${money(costs.gross)}</span>`
    : html`<span class=-num>${items.length}</span>`;

  return html.async`<div>${url ? html`<a href="${url}">${body}</a>` : body}</div>`;
}

export const cms = { node: { render, js: ["../shp3/pub/shp3.js", "pub/main.js"], settingsSchema } };
