import { html } from "@qino/qino";
import { cart } from "@qino/qino/cms.shop";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    heading: { type: "string", default: "2", description: "Level of the heading (1–6), or no for none." },
    editable: { type: "boolean", default: true, description: "The method can be chosen here; else only the chosen one is shown." },
  },
};

/** The payment methods that fit the cart, as the PHP module showed them. */
async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const order = await cart(ctx, false);
  const methods = order ? await order.payments() : [];
  if (!order || !methods.length) return html`<form></form>`;
  const active = await order.activePayment();
  const edit = await node.settings.editable() !== false;
  const heading = String(await node.settings.heading() ?? "2");
  const items = [];
  for (const m of methods) {
    if (!edit && m.name !== active) continue;
    items.push(html.async`<label>
        ${edit ? html`<span><input required type=radio name=method value="${m.name}" ${m.name === active ? html`checked` : ""}></span>` : ""}
        <span><span>${m.label}</span></span>
      </label>`);
  }
  return html.async`<form>
  ${heading === "no" ? "" : node.cms.text(node, "title", { tag: `h${heading}`, initial: { de: "Zahlungsmethode", en: "Payment method" } })}
  <div class=-options>${items}</div>
</form>`;
}

export const cms = { node: { render, js: ["../cms.shop/pub/shop.js", "pub/main.js"], settingsSchema } };
