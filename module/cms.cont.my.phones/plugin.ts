import type { Node } from "../cms/mod.ts";
import { html, type Ctx, type HtmlString } from "../core/mod.ts";

export const cms = { node: { js: ["pub/main.js"], render } };

function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;
  return html.async`<div>
  <div data-phones>${t`Loading…`}</div>
  <form data-add>
    <u2-fields>
      ${t`Phone number`} <input type=tel name=number placeholder="+41 79 123 45 67" required>
    </u2-fields>
    <button>${t`Add phone number`}</button>
  </form>
  <output class=-msg></output>
</div>`;
}
