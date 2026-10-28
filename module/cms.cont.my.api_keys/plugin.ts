import { html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { js: ["pub/main.js"], render } };

function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;
  u2.assets(ctx, ["el/time/time.js"]);
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
