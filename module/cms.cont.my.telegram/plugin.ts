import type { Node } from "../cms/mod.ts";
import { html, type Ctx, type HtmlString } from "../core/mod.ts";

export const cms = { node: { js: ["pub/main.js"], render } };

// The deep link lives 15 minutes, so it never reaches the rendered HTML — a cached page would
// hand out an expired one. The client fetches it, and fetches it again while it waits.
function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;
  return html.async`<div>
  <div data-state>${t`Loading…`}</div>
  <output class=-msg></output>
</div>`;
}
