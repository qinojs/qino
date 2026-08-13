import { html, type HtmlString, type Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import { cart } from "@qino/qino/shp3";

const settingsSchema = {
  properties: {
    editable: { type: "boolean", default: true, description: "Off shows the chosen method without letting it change." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  const order = await cart(ctx, false);
  const all = order ? await order.allowedPayments() : {};
  if (!Object.keys(all).length) return html.async`<div></div>`;

  const chosen = await order!.activePayment();
  const editable = await node.settings.editable() !== false;

  const options: HtmlString[] = [];
  for (const [key, title] of Object.entries(all)) {
    if (!editable && chosen !== key) continue;
    // The label is a CMS text, so the shop can word it — the setting is only the fallback.
    const text = await node.text(`payment_${key}`, ctx.lang);
    options.push(html`<label>
      ${editable ? html`<input type=radio name=payment value=${key} ${chosen === key ? html.raw("checked") : ""} required>` : ""}
      <span class=-title>${await text.get() || title}</span>
    </label>`);
  }

  return html.async`<div>
  <h2>${t`Payment method`}</h2>
  <form class=-payment>${html.join(options)}</form>
</div>`;
}

export const cms = { node: { render, js: ["../shp3/pub/shp3.js", "pub/main.js"], settingsSchema } };
