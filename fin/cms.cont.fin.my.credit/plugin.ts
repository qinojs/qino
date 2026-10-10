import { html } from "@qino/qino";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { js: ["pub/main.js"], render } };

/** A user's credit: the balance per currency and what moved. */
function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;
  return html.async`<div>
  <div data-credit>${t`Loading…`}</div>
  <output class=-msg></output>
</div>`;
}
