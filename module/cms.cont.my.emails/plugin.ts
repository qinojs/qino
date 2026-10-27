import { html } from "@qino/qino";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { js: ["pub/main.js"], render } };

function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;
  return html.async`<div>
  <div data-emails>${t`Loading…`}</div>
  <form data-add>
    <u2-fields>
      ${t`Email address`} <input type=email name=address placeholder="name@example.com" required>
    </u2-fields>
    <button>${t`Add email address`}</button>
  </form>
  <output class=-msg></output>
</div>`;
}
