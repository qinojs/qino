import type { Node } from "../cms/mod.ts";
import { hee, html, type Ctx, type HtmlString } from "../core/mod.ts";
import { providers } from "../oauth/plugin.ts";

export const name = "cms.cont.socialLogin";
export const needs = ["cms", "oauth"];

/** Renders one "Log in with …" link per configured login provider. */
async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const app = node.app;
  if (ctx.user && !node.edit) return html.raw(""); // nothing to offer once logged in

  const list = await providers(app);
  if (!list.length) return html.raw(node.edit ? `<em>${hee(await app.t`No login providers configured.`)}</em>` : "");

  const base = ctx.req.basePath;
  const returnTo = ctx.req.url.pathname + ctx.req.url.search;
  const label = await app.t`Log in with`;
  const buttons = list.map((p) => {
    const href = base + "oauth/start/" + encodeURIComponent(p.name) + "?return_to=" + encodeURIComponent(returnTo);
    return `<a class=btn href="${hee(href)}">${hee(label + " " + p.name)}</a>`;
  });
  return html.raw(`<div>${buttons.join("\n")}</div>`);
}

export const cms = { node: { render } };
