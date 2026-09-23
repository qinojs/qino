import { html } from "@qino/qino";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { js: ["pub/main.js"], render } };

// The deep link is valid 15 minutes, so it is not in the HTML (a cached page would show an expired
// one). The client fetches it, and refetches while waiting.
function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;
  return html.async`<div>
  <div data-state>${t`Loading…`}</div>
  <output class=-msg></output>
</div>`;
}
