import { html } from "@qino/qino";
import { providers } from "@qino/qino/auth.oauth";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { js: ["pub/main.js"], render } };

// Connecting redirects to the provider, so plain links; only the list is fetched.
async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const app = node.app;
  const t = app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;

  const returnTo = ctx.req.url.pathname + ctx.req.url.search;
  const label = await t`Connect`;
  const offers = (await providers(app)).map((p) => {
    const href = ctx.req.appUrl + "oauth/start/" + encodeURIComponent(p.name) + "?return_to=" + encodeURIComponent(returnTo);
    return html`<a href="${href}" data-connect="${p.name}">${label + " " + p.name}</a>`;
  });

  return html`<div>
  <div data-links>${await t`Loading…`}</div>
  <div data-offers>${offers.length ? html.join(offers, "\n") : html`<em>${await t`No login providers configured.`}</em>`}</div>
  <output class=-msg></output>
</div>`;
}
