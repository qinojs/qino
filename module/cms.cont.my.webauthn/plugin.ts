import { html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { js: ["pub/main.js"], render } };

function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;
  u2.assets(ctx, ["el/time/time.js"]);
  return html.async`<div data-api-base="${ctx.req.appUrl}api/auth.webauthn">
  <div data-keys>${t`Loading…`}</div>
  <input type=text data-name placeholder="${t`Name for this passkey`}">
  <button type=button data-add>${t`Add passkey`}</button>
  <output class=-msg></output>
</div>`;
}
