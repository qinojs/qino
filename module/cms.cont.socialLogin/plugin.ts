import type { Node } from "@qino/qino/cms";
import { html, type Ctx, type HtmlString } from "@qino/qino";
import { providers } from "@qino/qino/oauth";

/** Renders one "Log in with …" link per configured login provider. */
async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const app = node.app;
  if (ctx.user && !node.edit) return html.raw(""); // nothing to offer once logged in

  const list = await providers(app);
  if (!list.length) return node.edit ? html`<em>${await app.t`No login providers configured.`}</em>` : html.raw("");

  const base = ctx.req.appUrl;
  const returnTo = ctx.req.url.pathname + ctx.req.url.search;
  const label = await app.t`Log in with`;
  const buttons = list.map((p) => {
    const href = base + "oauth/start/" + encodeURIComponent(p.name) + "?return_to=" + encodeURIComponent(returnTo);
    return html`<a class=btn href="${href}">${label + " " + p.name}</a>`;
  });
  return html`<div>${html.join(buttons, "\n")}</div>`;
}

export const cms = { node: { render } };
