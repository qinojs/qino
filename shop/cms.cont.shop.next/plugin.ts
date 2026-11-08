import { html } from "@qino/qino";
import { cart, shopT, stepUrl } from "@qino/qino/cms.shop";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    back: { type: "string", default: "auto", description: "Page for the back button: a page id, auto (the previous one), or empty for none." },
    next: { type: "string", default: "auto", description: "Page for the next button: a page id, auto (the first below, else the next one), or empty for none." },
    check: { type: "string", default: "has lines", description: "Order checks that have to pass before going on (has lines, has address, has shipping, has payment, line errors)." },
    hideInactive: { type: "boolean", default: false, description: "Hide the next button while a check fails." },
  },
};

/** Back and next of a checkout step; next waits for the checks named. */
async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = shopT(node.app), settings = node.settings;
  const order = await cart(ctx, false);
  const checks = String(await settings.check() ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const all = order ? await order.errors() : { "has lines": await t`Your shopping cart is empty` };
  const errors = checks.map((c) => all[c]).filter(Boolean);
  const [back, next] = await Promise.all([stepUrl(node, await settings.back(), "back"), stepUrl(node, await settings.next(), "next")]);
  const hide = errors.length && await settings.hideInactive();
  // buttons, as the PHP module had them: next shows the first thing missing instead of going on
  return html.async`<div data-errors="${JSON.stringify(errors)}">
  ${back ? html.async`<button type=button class=-back data-href="${back}">${node.cms.text(node, "back", { tag: "span", initial: { de: "Zurück", en: "Back" } })}</button>` : ""}
  ${next && !hide ? html.async`<button type=button class="-next ${errors.length ? "-disabled" : ""}" data-href="${next}">${node.cms.text(node, "next", { tag: "span", initial: { de: "Weiter", en: "Next" } })}</button>` : ""}
</div>`;
}

export const cms = { node: { render, js: ["../cms.shop/pub/shop.js", "pub/main.js"], css: ["pub/main.css"], settingsSchema } };
