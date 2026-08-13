import { html } from "@qino/qino";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { js: ["pub/main.js"], render } };

function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;
  return html.async`<div class=-m-api_keys>
  <div data-list>${t`Loading…`}</div>
  <form data-create>
    <input type=text data-name placeholder="${t`Name`}">
    <button>${t`Create key`}</button>
  </form>
  <output data-token hidden></output>
  <output class=-msg></output>
</div>`;
}
