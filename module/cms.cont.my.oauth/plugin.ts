import { html } from "@qino/qino";
import { providers } from "@qino/qino/auth.oauth";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { js: ["pub/main.js"], render } };

// Connecting is a full round trip to the provider, so those are plain links; only the list is fetched.
async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const app = node.app;
  if (!ctx.user) return html.async`<p>${app.t`Please sign in.`}</p>`;

  const returnTo = ctx.req.url.pathname + ctx.req.url.search;
  const label = await app.t`Connect`;
  const offers = (await providers(app)).map((p) => {
    const href = ctx.req.appUrl + "oauth/start/" + encodeURIComponent(p.name) + "?return_to=" + encodeURIComponent(returnTo);
    return html`<a href="${href}" data-connect="${p.name}">${label + " " + p.name}</a>`;
  });

  return html`<div>
  <div data-links>${await app.t`Loading…`}</div>
  <div data-offers>${offers.length ? html.join(offers, "\n") : html`<em>${await app.t`No login providers configured.`}</em>`}</div>
  <output class=-msg></output>
</div>`;
}
