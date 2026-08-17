import { html } from "@qino/qino";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { js: ["pub/main.js"], render } };

// The codes exist in one response and nowhere else, so they are fetched, never rendered.
function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;
  return html.async`<div>
  <div data-state>${t`Loading…`}</div>
  <div data-codes hidden></div>
  <button type=button data-generate></button>
  <output class=-msg></output>
</div>`;
}
