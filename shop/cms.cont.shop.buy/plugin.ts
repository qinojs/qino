import { html } from "@qino/qino";
import { cart, shopT, stepUrl } from "@qino/qino/cms.shop";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    back: { type: "string", default: "auto", description: "Page for the back button: a page id, auto (the previous one), or empty for none." },
    success: { type: "integer", description: "Page after a placed order, also where the payer comes back to; none: the first page below." },
  },
};

/** Place the order: what still blocks it is shown, the button is the last step. */
async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = shopT(node.app);
  const order = await cart(ctx, false);
  const errors = order ? Object.values(await order.errors()) : [await t`Your shopping cart is empty`];
  const page = await node.page();
  const success = Number(await node.settings.success() || 0);
  const first = (await page.children()).values().find((n) => n.vs.type === "p");
  const done = success ? await (await node.cms.node(success)).url() : first ? await first.url() : "";
  const back = await stepUrl(node, await node.settings.back(), "back");
  // main: what has to be agreed to before ordering (terms, privacy) — required fields hold the order back;
  // what else blocks it is said on the click (PHP: buy1)
  return html.async`<form data-success="${done}" data-payment-failed="${t`Your order has been received, but the payment could not be started. Try again?`}">
  ${node.cont("main")}
  ${back ? html.async`<a href="${back}"><button type=button class=-back>${node.cms.text(node, "back", { tag: "span", initial: { de: "Zurück", en: "Back" } })}</button></a>` : ""}
  <button class="-buy ${errors.length ? "-disabled" : ""}">${node.cms.text(node, "next", { tag: "span", initial: { de: "Bestellen", en: "Order" } })}</button>
</form>`;
}

export const cms = { node: { render, js: ["../cms.shop/pub/shop.js", "pub/main.js"], settingsSchema } };
