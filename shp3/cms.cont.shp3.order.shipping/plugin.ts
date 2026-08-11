import { html, type HtmlString, type Ctx } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { cart } from "../shp3/mod.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

const settingsSchema = {
  properties: {
    editable: { type: "boolean", default: true, description: "Off shows the chosen method without letting it change." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  const order = await cart(ctx, false);
  const all = order ? await order.allowedShippings() : {};
  if (!Object.keys(all).length) return html.async`<div></div>`;

  const chosen = await order!.activeShipping();
  const editable = await node.settings.editable() !== false;
  const currency = await order!.currencyRow();

  const options: HtmlString[] = [];
  for (const [key, title] of Object.entries(all)) {
    if (!editable && chosen !== key) continue;
    const cost = await order!.shippingCost(key);
    // The label is a CMS text, so the shop can word it — the setting is only the fallback.
    const text = await node.text(`shipping_${key}`, ctx.lang);
    options.push(html`<label>
      ${editable ? html`<input type=radio name=shipping value=${key} ${chosen === key ? html.raw("checked") : ""} required>` : ""}
      <span class=-title>${await text.get() || title}</span>
      <span class=-cost>${cost ? currency?.show(cost) ?? cost : await t`free`}</span>
    </label>`);
  }

  return html.async`<div>
  <h2>${t`Shipping method`}</h2>
  <form class=-shipping>${html.join(options)}</form>
</div>`;
}

export const cms = { node: { render, js: ["../shp3/pub/shp3.js", "pub/main.js"], settingsSchema } };
