import { html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { js: ["pub/main.js"], render } };

// The secret is only ever fetched by the client, so a cached page cannot carry one.
async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;
  await u2.assets(ctx, ["el/qrcode/qrcode.js"]);
  return html.async`<div>
  <div data-apps>${t`Loading…`}</div>
  <div data-setup hidden></div>
  <button type=button data-start>${t`Set up an authenticator app`}</button>
  <output class=-msg></output>
</div>`;
}
