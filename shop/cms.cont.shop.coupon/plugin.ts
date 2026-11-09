import { html } from "@qino/qino";
import { cart, shopT } from "@qino/qino/cms.shop";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = shopT(node.app), code = (await cart(ctx, false))?.$get("coupon");
  return html.async`<form data-wrong="${t`This code is not valid`}">
  ${code ? html.async`<span>${t`Coupon`}: ${code}</span> <button class=-remove>${t`Remove`}</button>`
    : html.async`<input name=code required aria-label="${t`Coupon`}"> <button>${t`Redeem`}</button>`}
</form>`;
}

export const cms = { node: { render, js: ["pub/main.js"] } };
